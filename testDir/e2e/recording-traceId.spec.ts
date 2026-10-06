import { test, expect } from './fixtures/extension.fixture.js';
import { seedPrivacyConsent } from './fixtures/privacyConsentSeed.js';

/**
 * PBI-21: Recording pipeline traceId correlation E2E test
 *
 * Navigates a test page, satisfies VALID_VISIT conditions (50% scroll + 5s stay),
 * then verifies that the Service Worker's `sanitization_logs` contain entries
 * sharing a single traceId for the recording.
 */

test.describe('Recording traceId correlation @extension', () => {
  // WHY: the SW logger buffers entries until BATCH_FLUSH_SIZE=10, so the spec
  // polls the flush condition itself instead of a fixed timeout.
  test('logs for a single recording share the same traceId', async ({ context }) => {
    await seedPrivacyConsent(context, {
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

    const page = await context.newPage();

    await test.step('Navigate to test page', async () => {
      await page.goto('http://localhost:8080/long-page.html');
    });

    await test.step('Wait for content script extractor initialization', async () => {
      await expect.poll(
        async () => {
          const attr = await page.evaluate(() => document.documentElement.getAttribute('data-ow-test-state'));
          if (!attr) return null;
          try {
            return JSON.parse(attr) as unknown;
          } catch {
            return null;
          }
        },
        { timeout: 10000, intervals: [200] },
      ).toHaveProperty('minVisitDuration');
    });

    await test.step('Scroll to 70% of page', async () => {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.7));
    });

    await test.step('Wait for VALID_VISIT to fire', async () => {
      await expect.poll(
        async () => {
          const attr = await page.evaluate(() => document.documentElement.getAttribute('data-ow-test-state'));
          if (!attr) return null;
          try {
            return JSON.parse(attr) as { isValidVisitReported?: boolean } | null;
          } catch {
            return null;
          }
        },
        { timeout: 15000, intervals: [1000] },
      ).toMatchObject({ isValidVisitReported: true });
    });

    // The pipeline generates logs across 10+ steps. Once the buffer hits
    // BATCH_FLUSH_SIZE (10), persistPending() flushes to chrome.storage.local
    // immediately. Allow extra time for the async pipeline to complete all steps
    // and for the flush to propagate.
    await test.step('Verify all recent logs share the same traceId', async () => {
      const testUrl = 'http://localhost:8080/long-page.html';

      // Poll the flush condition itself: a single non-empty traceId across
      // recent logs for the test URL. Returning null retries the poll.
      await expect.poll(
        async () => {
          const sw = context.serviceWorkers()[0];
          if (!sw) return null;
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

          if (recentLogs.length === 0) return null;
          const traceIds = new Set(recentLogs.map((log) => log.traceId).filter(Boolean));
          if (traceIds.size !== 1) return null;
          const traceId = Array.from(traceIds)[0];
          return typeof traceId === 'string' && traceId.length > 0 ? traceId : null;
        },
        { timeout: 30000, intervals: [2000] },
      ).toBeTruthy();
    });

    await page.close();
  });
});
