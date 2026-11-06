import { test, expect } from './fixtures/extension.fixture.js';
import { seedPrivacyConsent } from './fixtures/privacyConsentSeed.js';
import {
  enableE2EProbe,
  readE2EProbeState,
} from './fixtures/e2eProbe.js';
import { createServer, type Server } from 'node:http';
import { pickLoopbackPort, listenHttp } from './fixtures/localServers.js';

/**
 * PBI-21: Recording pipeline traceId correlation E2E test
 *
 * Navigates a test page, satisfies VALID_VISIT conditions (50% scroll + 5s stay),
 * then verifies that the Service Worker's `sanitization_logs` contain entries
 * sharing a single traceId for the recording.
 *
 * AI is mocked (lm-studio slot on a loopback mock server, the same harness as
 * regenerate-summary.spec.ts): without it the pipeline spends the whole poll
 * window failing over real AI providers (cycle-2 diag: still in "AI provider
 * slot failed, trying next provider" at timeout, zero url-bearing logs), so
 * the spec would depend on external network timing instead of the traceId
 * correlation it pins. Port must be in ssrfGuard ALLOWED_LOCALHOST_PORTS;
 * 11434 (Ollama default) is preferred as least contested.
 */
const MOCK_PORT_DEFAULT = 11434;
let MOCK_PORT = MOCK_PORT_DEFAULT;
const MARKER =
  'E2E-TRACE-MARKER mock provider summary of the long test page for verification purposes.';

let mockServer: Server | undefined;

test.beforeAll(async () => {
  MOCK_PORT = await pickLoopbackPort();
  console.log(`AI MOCK PORT ${MOCK_PORT}`);
  mockServer = createServer((req, res) => {
    const pathOnly = (req.url || '/').split('?')[0] || '/';
    console.log(`AI MOCK HIT ${req.method} ${pathOnly}`);
    if (req.method === 'POST' && pathOnly === '/v1/chat/completions') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => { chunks.push(c); });
      req.on('end', () => {
        // OpenAI-style chat completion; content is plain prose (no JSON-in-JSON
        // contract, >= SUMMARY_MIN_LENGTH=10, no '|' so tags parse empty).
        const payload = {
          id: 'chatcmpl-e2e',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'e2e-mock-model',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: MARKER },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
        };
        const body = JSON.stringify(payload);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
        res.end(body);
      });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });
  await listenHttp(mockServer, MOCK_PORT, '127.0.0.1');
  console.log(`AI MOCK LISTENING http://127.0.0.1:${MOCK_PORT}`);
});

test.afterAll(() => {
  mockServer?.close();
  mockServer = undefined;
});

/** Merge the lm-studio mock provider into the single 'settings' blob. */
async function seedAiMockSettings(context: import('@playwright/test').BrowserContext): Promise<void> {
  // Service-worker evaluate (not page.evaluate): a fresh about:blank page has
  // no chrome.storage, mirroring seedPrivacyConsent's own channel.
  const sw = context.serviceWorkers()[0];
  expect(sw, 'service worker must be running').toBeTruthy();
  await sw!.evaluate(async (port: number) => {
    const res = await chrome.storage.local.get('settings');
    const current = (res.settings as Record<string, unknown>) ?? {};
    await chrome.storage.local.set({
      settings: {
        ...current,
        ai_provider_priority_list: [{ provider: 'lm-studio', model: 'e2e-mock-model' }],
        lm_studio_base_url: `http://127.0.0.1:${port}/v1`,
        lm_studio_model: 'e2e-mock-model',
      },
    });
  }, MOCK_PORT);
}

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
    // Probe is armed extension-side (session flag) — must precede navigation:
    // the content script resolves the flag once at init.
    await enableE2EProbe(context);
    // AI mock first slot, before navigation (the pipeline reads settings at
    // record time, well after VALID_VISIT, but seeding up front is explicit).
    await seedAiMockSettings(context);

    await test.step('Navigate to test page', async () => {
      await page.goto('http://localhost:8080/long-page.html');
    });

    await test.step('Wait for content script extractor initialization', async () => {
      await expect.poll(
        async () => readE2EProbeState(context),
        { timeout: 10000, intervals: [200] },
      ).toHaveProperty('minVisitDuration');
    });

    await test.step('Scroll to 70% of page', async () => {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.7));
    });

    await test.step('Wait for VALID_VISIT to fire', async () => {
      await expect.poll(
        async () => readE2EProbeState(context),
        { timeout: 15000, intervals: [1000] },
      ).toMatchObject({ isValidVisitReported: true });
    });

    // The pipeline generates logs across 10+ steps. Once the buffer hits
    // BATCH_FLUSH_SIZE (10), persistPending() flushes to chrome.storage.local
    // immediately. Allow extra time for the async pipeline to complete all steps
    // and for the flush to propagate.
    await test.step('Verify all recent logs share the same traceId', async () => {
      const testUrl = 'http://localhost:8080/long-page.html';

      // Diagnostic snapshot of the last poll iteration. Written on every
      // iteration, attached only when the poll below times out (catch path).
      // The predicate itself is unchanged: a single non-empty traceId across
      // recent logs for the test URL. Returning null retries the poll.
      let lastDiag: Record<string, unknown> = { phase: 'poll-not-started' };
      try {
        await expect.poll(
          async () => {
            const sw = context.serviceWorkers()[0];
            if (!sw) {
              lastDiag = { phase: 'no-service-worker' };
              return null;
            }
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
            const recentLogs = logs.filter((log) => log.timestamp > cutoff);
            const urlMatched = recentLogs.filter(
              (log) =>
                log.details?.url === testUrl ||
                log.message?.includes('long-page') ||
                (log.details?.url as string)?.includes('localhost:8080'),
            );
            const traceIds = new Set(urlMatched.map((log) => log.traceId).filter(Boolean));
            const messageHistogram: Record<string, number> = {};
            for (const log of urlMatched) {
              messageHistogram[log.message] = (messageHistogram[log.message] ?? 0) + 1;
            }
            // Cycle-2 widening: the failure mode seen in CI is urlMatched 0
            // with a full 10-log flush behind it, so the recent window itself
            // must be described. Messages are template strings (capped) and
            // only detail KEY presence is recorded — never values (PII-safe).
            // Keep it that way: CI attachments persist for days, so detail
            // values must never be added here even if a future failure makes
            // them tempting.
            const recentMessageHistogram: Record<string, number> = {};
            const recentDetailKeyHistogram: Record<string, number> = {};
            let recentWithUrl = 0;
            let recentWithTraceId = 0;
            for (const log of recentLogs) {
              const capped = log.message.length > 80 ? `${log.message.slice(0, 80)}…` : log.message;
              recentMessageHistogram[capped] = (recentMessageHistogram[capped] ?? 0) + 1;
              const keys = Object.keys(log.details ?? {});
              for (const key of keys) {
                recentDetailKeyHistogram[key] = (recentDetailKeyHistogram[key] ?? 0) + 1;
              }
              if (typeof log.details?.url === 'string') recentWithUrl += 1;
              if (typeof log.traceId === 'string' && log.traceId.length > 0) recentWithTraceId += 1;
            }
            lastDiag = {
              phase: 'polled',
              totalLogs: logs.length,
              recentLogs: recentLogs.length,
              urlMatched: urlMatched.length,
              distinctTraceIds: Array.from(traceIds),
              missingTraceId: urlMatched.filter((log) => !log.traceId).length,
              messageHistogram,
              recentMessageHistogram,
              recentDetailKeyHistogram,
              recentWithUrl,
              recentWithTraceId,
            };

            if (urlMatched.length === 0) return null;
            if (traceIds.size !== 1) return null;
            const traceId = Array.from(traceIds)[0];
            return typeof traceId === 'string' && traceId.length > 0 ? traceId : null;
          },
          { timeout: 30000, intervals: [2000] },
        ).toBeTruthy();
      } catch (error) {
        try {
          await test.info().attach('traceid-poll-diag', {
            body: Buffer.from(JSON.stringify(lastDiag, null, 2), 'utf-8'),
            contentType: 'application/json',
          });
        } catch {
          // Attach is best-effort; the original error below is what matters.
        }
        throw error;
      }
    });

    await page.close();
  });
});
