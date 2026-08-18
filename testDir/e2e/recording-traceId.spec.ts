import { test, expect } from './fixtures/extension.fixture.js';

/**
 * PBI-21: Recording pipeline traceId correlation E2E test
 *
 * Navigates a test page, satisfies VALID_VISIT conditions (50% scroll + 5s stay),
 * then verifies that the Service Worker's `sanitization_logs` contain entries
 * sharing a single traceId for the recording.
 */

// Must match PRIVACY_POLICY_VERSION in src/popup/privacyConsent.ts.
// If this test starts failing with "privacy_consent_required", check this constant first.
const PRIVACY_POLICY_VERSION = '2026-07-31';

test.describe('Recording traceId correlation @extension', () => {
  test('logs for a single recording share the same traceId', async ({ context }) => {
    const sw = context.serviceWorkers()[0];

    // Pre-seed privacy consent and basic settings so the service worker processes recordings.
    // The consent version MUST match PRIVACY_POLICY_VERSION or hasPrivacyConsent() returns false,
    // causing VALID_VISIT to be rejected with 'privacy_consent_required'.
    await sw.evaluate(async (version: string) => {
      await chrome.storage.local.set({
        privacy_consent: { hasConsented: true, consentVersion: version, consentDate: Date.now() },
        privacy_consent_version: version,
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
    }, PRIVACY_POLICY_VERSION);

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

    // The pipeline generates logs across 10+ steps. Once the buffer hits
    // BATCH_FLUSH_SIZE (10), persistPending() flushes to chrome.storage.local
    // immediately. Allow extra time for the async pipeline to complete all steps
    // and for the flush to propagate.
    await test.step('Verify all recent logs share the same traceId', async () => {
      const testUrl = 'http://localhost:8080/long-page.html';

      // Poll for logs with retries — the pipeline may still be writing entries.
      await expect(async () => {
        const sw = context.serviceWorkers()[0];
        const logs = await sw.evaluate(async () => {
          const result = await chrome.storage.local.get('sanitization_logs');
          return (result.sanitization_logs || []) as Array<{
            message: string;
            traceId?: string;
            details?: Record<string, unknown>;
            timestamp: number;
          }>;
        });

        // Keep only logs emitted in the last 30 seconds that relate to the test URL
        const cutoff = Date.now() - 30000;
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
      }).toPass({ timeout: 15000, intervals: [1000] });
    });

    await page.close();
  });
});
