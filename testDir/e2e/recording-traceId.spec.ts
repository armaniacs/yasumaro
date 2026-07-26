import { test, expect } from './fixtures/extension.fixture.js';

/**
 * PBI-21: 記録パイプラインの traceId 一貫性を検証する E2E テスト
 *
 * テストページで VALID_VISIT 条件（50% スクロール + 5 秒滞在）を満たし、
 * Service Worker 側の `sanitization_logs` に書き込まれたログが
 * 同一 traceId で相関されていることを確認する。
 */

test.describe('Recording traceId correlation @extension', () => {
  test('logs for a single recording share the same traceId', async ({ context }) => {
    const sw = context.serviceWorkers()[0];

    // Pre-seed privacy consent and basic settings so the service worker processes recordings.
    // Consent must include hasConsented=true and the current policy version; signature is optional.
    await sw.evaluate(async () => {
      await chrome.storage.local.set({
        privacy_consent: { hasConsented: true, consentVersion: '2026-06-20', consentDate: Date.now() },
        privacy_consent_version: '2026-06-20',
        settings_migrated: true,
        settings: {
          obsidian_protocol: 'http',
          obsidian_host: '127.0.0.1',
          obsidian_port: 27123,
          obsidian_daily_path: '',
          ai_provider: 'gemini',
          min_visit_duration: 5,
          min_scroll_depth: 50,
        },
      });
    });

    const page = await context.newPage();

    await test.step('Navigate to test page', async () => {
      await page.goto('http://localhost:8080/long-page.html');
    });

    await test.step('Wait for content script extractor initialization', async () => {
      await expect(async () => {
        const attr = await page.evaluate(() => document.documentElement.getAttribute('data-ow-test-state'));
        if (!attr) throw new Error('data-ow-test-state not yet set');
        const state = JSON.parse(attr);
        expect(state).toHaveProperty('minVisitDuration');
      }).toPass({ timeout: 10000, intervals: [200] });
    });

    await test.step('Scroll to 70% of page', async () => {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.7));
    });

    await test.step('Wait for VALID_VISIT to fire', async () => {
      await expect(async () => {
        const state = await page.evaluate(() => {
          const attr = document.documentElement.getAttribute('data-ow-test-state');
          return attr ? JSON.parse(attr) : null;
        });
        expect(state).not.toBeNull();
        expect(state.isValidVisitReported).toBe(true);
      }).toPass({ timeout: 15000, intervals: [1000] });
    });

    // Give the service worker pipeline time to log (Obsidian/SQLite may fail in test env,
    // but log entries should still be written with a shared traceId).
    await page.waitForTimeout(3000);

    await test.step('Verify all recent logs share the same traceId', async () => {
      const sw = context.serviceWorkers()[0];
      const logs = await sw.evaluate(async () => {
        // Flush any buffered logs before reading storage
        const logger = await import('chrome-extension://invalid/utils/logger.js').catch(() => null);
        if (logger && 'flushLogs' in logger) {
          await (logger as any).flushLogs(true);
        }
        const result = await chrome.storage.local.get('sanitization_logs');
        return (result.sanitization_logs || []) as Array<{
          message: string;
          traceId?: string;
          details?: Record<string, unknown>;
          timestamp: number;
        }>;
      });

      const testUrl = 'http://localhost:8080/long-page.html';
      // Keep only logs emitted in the last 20 seconds that relate to the test URL
      const cutoff = Date.now() - 20000;
      const recentLogs = logs.filter(
        (log) =>
          log.timestamp > cutoff &&
          (log.details?.url === testUrl ||
            log.message?.includes('long-page') ||
            (log.details?.url as string)?.includes('localhost:8080'))
      );

      expect(recentLogs.length, 'Expected at least one log entry for the recording').toBeGreaterThan(0);

      const traceIds = new Set(recentLogs.map((log) => log.traceId).filter(Boolean));
      expect(traceIds.size, 'Expected all recent logs to share a single traceId').toBe(1);

      const traceId = Array.from(traceIds)[0];
      expect(typeof traceId).toBe('string');
      expect((traceId as string).length).toBeGreaterThan(0);
    });

    await page.close();
  });
});
