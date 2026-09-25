import { test, expect } from './fixtures/extension.fixture.js';
import { seedPrivacyConsent } from './fixtures/privacyConsentSeed.js';
import {
  openOptionsPage,
  createDashboardSqliteClient,
  seedRows,
  migrationSettled,
  poll,
} from './fixtures/dashboardSqliteHelpers.js';
import { createServer, type Server } from 'node:http';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pickLoopbackPort, listenHttp } from './fixtures/localServers.js';

/**
 * AI summary regenerate full flow (PBI 2026-09-22-04) @extension
 *
 * CRITICAL: same-row UPDATE (summary flips to the mock marker, still exactly
 * one row for the URL) + cleansing settings never persist the cleanseMode.
 * IMPORTANT: invalid_url error row appears WITHOUT a force button (invalid_url
 * is not force-offerable — Ask Q1C).
 *
 * WHY https://api.openai.com/e2e/… as the entry URL: checkPermissionStep gates
 * on chrome.permissions.contains(origin) (only manifest host_permissions pass)
 * while the handler's validateUrl({ blockLocalhost: true }) rejects every
 * localhost origin. api.openai.com is in the always-granted
 * AI_PROVIDER_HOST_PERMISSIONS, so it clears both gates.
 *
 * HOW the fixture is served: extension-created tabs escape Playwright route
 * interception on their main-document request (context.route/page.route lose
 * the attach race → chrome-error page → no content script). The extension
 * fixture therefore launches with
 * `--host-resolver-rules=MAP api.openai.com:443 127.0.0.1:8443` and THIS spec
 * runs a local self-signed TLS server on 8443 (cert in ./fixtures/) — the
 * tab's real navigation resolves locally with the correct https:// URL.
 * WHY lm-studio @ 127.0.0.1:11434 (seeded, NOT the catalog default1234) for
 * the AI mock: validateUrlForAIRequests + isAllowedProviderBaseUrl(isLocal) +
 * ALLOWED_LOCALHOST_PORTS all accept11434, no API key setting exists for
 * lm-studio, and1234 is the real LM Studio desktop app's port on dev machines.
 * Default PRIVACY_MODE ('masked_cloud') routes the pipeline straight to the
 * remote service → AI_PROVIDER_PRIORITY_LIST slot → OpenAI-compatible strategy
 * → POST {base}/chat/completions — answered by the in-spec mock server.
 *
 * Projection note: the `query` list projection carries summary but NOT
 * content/fallback_reason (BROWSING_LOG_COLUMNS) — re-extracted content is
 * asserted via the legacy dual-write (savedUrlsWithTimestamps) instead.
 */

// AI mock port — must be in ssrfGuard ALLOWED_LOCALHOST_PORTS
// {11434,27123,27124,1234}. NEVER a fixed 1234: the catalog default for
// lm-studio AND the real LM Studio desktop app's port (observed owning
// 127.0.0.1:1234 on dev machines — the SW's fetch would reach the REAL app
// instead of any test mock). The spec probe-and-picks the first FREE
// permitted port (fixtures/localServers.ts) and seeds lm_studio_base_url
// to it;11434 (Ollama default) is preferred as least contested.
const MOCK_PORT_DEFAULT = 11434;
let MOCK_PORT = MOCK_PORT_DEFAULT;
const FIXTURE_TLS_PORT = 8443; // entry-page TLS server (host-resolver target)
const ENTRY_URL = 'https://api.openai.com/e2e/regen-fixture.html';
const ENTRY_TITLE = 'Regen fixture page';
const OLD_SUMMARY = 'OLD SUMMARY';
const MARKER =
  'E2E-REGEN-MARKER-9f27 mock provider summary of the fixture page for verification purposes.';
const ERROR_URL = 'http://localhost:9/never.html';

const FIXTURE_HTML = `<!DOCTYPE html>
<html data-ow-e2e-test="true" lang="en">
<head><meta charset="utf-8"><title>${ENTRY_TITLE}</title></head>
<body>
<article>
<h1>Garden journaling notes</h1>
<p>Morning light across the planter beds makes it easy to spot new sprouts pushing through the soil after the overnight rain.</p>
<p>Trimmed the hedges along the north fence and gathered the clippings into the compost bin near the shed.</p>
<p>Seeded a fresh row of herbs beside the stone path and watered everything deeply before the midday heat arrived.</p>
<p>Noted which beds drain fastest so the next planting round can match each variety to its preferred moisture level.</p>
</article>
<div class="intro-block"><p>Extra paragraphs keep the extractor comfortably above the candidate floor.</p></div>
<div class="detail-block"><p>Second filler block with calm neutral prose about seasonal planting schedules.</p></div>
</body>
</html>`;

let mockServer: Server | undefined;
let fixtureTlsServer: HttpsServer | undefined;

test.beforeAll(async () => {
  // Probe-and-pick a free permitted loopback port BEFORE building the mock
  // (occupied-port candidates are skipped; EADDRINUSE can never race the test).
  MOCK_PORT = await pickLoopbackPort();
  console.log(`AI MOCK PORT ${MOCK_PORT}`);

  // AI mock (plain HTTP; baseUrl seeded to this port below).
  mockServer = createServer((req, res) => {
    const pathOnly = (req.url || '/').split('?')[0] || '/';
    console.log(`AI MOCK HIT ${req.method} ${pathOnly}`);
    if (req.method === 'POST' && pathOnly === '/v1/chat/completions') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => { chunks.push(c); });
      req.on('end', () => {
        // Model-discriminated failure: providers whose model name contains
        // "broken" answer 500, letting one spec prove cross-provider fallback
        // (slot1 down → slot2 up) and another prove total-failure handling.
        let model = '';
        try {
          model = String((JSON.parse(Buffer.concat(chunks).toString('utf8')) as { model?: unknown }).model ?? '');
        } catch { /* unparseable body → success path */ }
        if (model.includes('broken')) {
          const errBody = JSON.stringify({ error: { message: 'mock provider down', type: 'server_error' } });
          res.writeHead(500, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(errBody) });
          res.end(errBody);
          return;
        }
        // OpenAI-style chat completion; content is plain prose (no JSON-in-JSON
        // contract, ≥ SUMMARY_MIN_LENGTH=10, no '|' so tags parse empty).
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
  // Explicit IPv4 loopback + awaited bind: matches the seeded base URL exactly
  // (a bare listen() can end up IPv6-only while the fetch targets127.0.0.1,
  // and a fire-and-forget bind races the first test).
  await listenHttp(mockServer, MOCK_PORT, '127.0.0.1');
  console.log(`AI MOCK LISTENING http://127.0.0.1:${MOCK_PORT}`);

  // Entry-page TLS server — reached via --host-resolver-rules MAP (see header).
  const fixturesDir = join(process.cwd(), 'testDir/e2e/fixtures');
  fixtureTlsServer = createHttpsServer(
    {
      cert: readFileSync(join(fixturesDir, 'dev-server-cert.pem')),
      key: readFileSync(join(fixturesDir, 'dev-server-key.pem')),
    },
    (req, res) => {
      console.log(`TLS FIXTURE HIT ${req.method} ${req.url}`);
      const pathOnly = (req.url || '/').split('?')[0] || '/';
      if (req.method === 'GET' && pathOnly === '/e2e/regen-fixture.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(FIXTURE_HTML);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    },
  );
  // Awaited IPv4 bind: the host-resolver MAP targets127.0.0.1:8443 exactly.
  await listenHttp(fixtureTlsServer, FIXTURE_TLS_PORT, '127.0.0.1');
});

test.afterAll(() => {
  mockServer?.close();
  mockServer = undefined;
  fixtureTlsServer?.close();
  fixtureTlsServer = undefined;
});

async function seedConsent(context: import('@playwright/test').BrowserContext) {
  await seedPrivacyConsent(context);
}

/** Merge the lm-studio mock provider into the single 'settings' blob. */
async function seedAiMockSettings(
  page: import('@playwright/test').Page,
  priority: Array<{ provider: string; model: string }> = [
    { provider: 'lm-studio', model: 'e2e-mock-model' },
  ],
) {
  await page.evaluate(async (args: { port: number; priority: Array<{ provider: string; model: string }> }) => {
    const res = await chrome.storage.local.get('settings');
    const current = (res.settings as Record<string, unknown>) ?? {};
    await chrome.storage.local.set({
      settings: {
        ...current,
        ai_provider_priority_list: args.priority,
        lm_studio_base_url: `http://127.0.0.1:${args.port}/v1`,
        lm_studio_model: 'e2e-mock-model',
      },
    });
  }, { port: MOCK_PORT, priority });
}

function pickCleansingKeys(settings: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(settings)) {
    if (k.startsWith('content_strip_') || k.startsWith('ai_summary_cleansing_') ||
        k === 'cleansing_preset' || k === 'domain_cleansing_overrides' ||
        k.startsWith('extraction_guard_')) {
      out[k] = v;
    }
  }
  return out;
}

async function readSettings(page: import('@playwright/test').Page): Promise<Record<string, unknown>> {
  const res = await page.evaluate(() => chrome.storage.local.get('settings'));
  return (res.settings as Record<string, unknown>) ?? {};
}

test.describe('Regenerate summary @extension', () => {
  test('CRITICAL: regenerate UPDATES the same row (no duplicate) and never persists cleanseMode', async ({ context, extensionId }) => {
    test.setTimeout(120_000); // gateway budget 60s + tab load + AI + save headroom
    const consoleLogs: string[] = [];

    await seedConsent(context);

    const page = await openOptionsPage(context, extensionId);
    page.on('console', (m) => consoleLogs.push(`[options ${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => consoleLogs.push(`[OPTIONS_ERROR] ${e.message}`));
    try {
        const client = createDashboardSqliteClient(page);
        await migrationSettled(page, client);
        await seedAiMockSettings(page);
        const cleansingBefore = pickCleansingKeys(await readSettings(page));

        await seedRows(client, [{
          url: ENTRY_URL,
          title: ENTRY_TITLE,
          summary: OLD_SUMMARY,
          created_at: Date.UTC(2026, 8, 1, 12, 0, 0),
          domain: 'api.openai.com',
        }]);

        await page.locator('[data-panel="panel-sqlite-history"]').click();
        const row = page.locator('#sqlite-entry-list .sqlite-entry', { hasText: ENTRY_TITLE });
        await row.waitFor({ state: 'visible', timeout: 15_000 });
        const rowId = Number(await row.getAttribute('data-id'));
        expect(rowId, 'seeded row must expose data-id').toBeGreaterThan(0);

        // Drive the looser rung through the real header select.
        await row.locator('.regenerate-mode-select').selectOption('looser');
        await row.locator('[data-action="regenerate"]').click();

        // Poll the real query projection until the mock marker lands.
        // 30 × 2000ms = 60s matches REGENERATE_TIMEOUT_MS. poll() returns the
        // LAST value on exhaustion (never throws) — treat a missing marker as
        // the failure and dump a direct handler probe for root cause.
        const res = await poll(
          () => client.dashboardMsg({ subtype: 'query', domain: 'api.openai.com', limit: 20, offset: 0 } as never),
          (r) => {
            const rows = (r?.['rows'] as Array<{ url?: string; summary?: string }> | undefined) ?? [];
            return rows.some((x) => x.url === ENTRY_URL && (x.summary ?? '').includes('E2E-REGEN-MARKER-9f27'));
          },
          30,
          2000,
        );
        const rows = (res?.['rows'] as Array<{ url?: string; summary?: string; id?: number }>) ?? [];
        const matches = rows.filter((x) => x.url === ENTRY_URL);
        const landed = matches.some((x) => (x.summary ?? '').includes('E2E-REGEN-MARKER-9f27'));
        if (!landed) {
          // Root-cause probe: invoke the handler once directly and report its
          // verbatim response alongside the captured options-page console.
          const probe = await page.evaluate(async (payload) => {
            try {
              return await chrome.runtime.sendMessage({
                type: 'REGENERATE_SUMMARY',
                payload,
                protocolVersion: 1,
              });
            } catch (e) {
              return { success: false, error: String(e) };
            }
          }, { id: rowId, url: ENTRY_URL, title: ENTRY_TITLE, cleanseMode: 'looser' });
          throw new Error(
            `marker not landed.\nrows=${JSON.stringify(matches)}\nhandler probe=${JSON.stringify(probe)}\nconsole:\n${consoleLogs.join('\n')}`,
          );
        }
        expect(
          matches.length,
          `expected exactly one row for ${ENTRY_URL}: ${JSON.stringify(res).slice(0, 2000)}\nconsole:\n${consoleLogs.join('\n')}`,
        ).toBe(1);
        expect(matches[0]!.summary).toContain('E2E-REGEN-MARKER-9f27');
        expect(matches[0]!.summary).not.toBe(OLD_SUMMARY);

        // Re-extracted content landed via the legacy dual-write (the query
        // projection never carries content by design).
        const stored = await page.evaluate(async () => {
          const r = await chrome.storage.local.get('savedUrlsWithTimestamps');
          return (r.savedUrlsWithTimestamps as Array<Record<string, unknown>>) ?? [];
        });
        const legacy = stored.find((e) => e['url'] === ENTRY_URL);
        expect(
          legacy,
          `legacy metadata missing for ${ENTRY_URL}\nconsole:\n${consoleLogs.join('\n')}`,
        ).toBeDefined();
        expect(String(legacy!['content'] ?? '').length).toBeGreaterThan(0);

        // Binding: the ladder never persists to chrome.storage.
        const cleansingAfter = pickCleansingKeys(await readSettings(page));
        expect(cleansingAfter).toEqual(cleansingBefore);
    } finally {
      await page.close();
    }

    if (consoleLogs.length > 0) console.log('Browser console:\n' + consoleLogs.join('\n'));
  });

  test('IMPORTANT: invalid_url shows an in-row error with NO force button', async ({ context, extensionId }) => {    test.setTimeout(120_000);
    await seedConsent(context);

    const page = await openOptionsPage(context, extensionId);
    try {
      const client = createDashboardSqliteClient(page);
      await migrationSettled(page, client);
      await seedRows(client, [{
        url: ERROR_URL,
        title: 'Never page',
        summary: OLD_SUMMARY,
        created_at: Date.UTC(2026, 8, 2, 12, 0, 0),
        domain: 'localhost',
      }]);

      await page.locator('[data-panel="panel-sqlite-history"]').click();
      const row = page.locator('#sqlite-entry-list .sqlite-entry', { hasText: 'Never page' });
      await row.waitFor({ state: 'visible', timeout: 15_000 });
      await row.locator('[data-action="regenerate"]').click();

      // invalid_url is NOT force-offerable: error row appears, force button
      // absent. Text is locale-dependent — assert structure, not wording.
      await expect(row.locator('.regenerate-error-row')).toBeVisible({ timeout: 30_000 });
      await expect(row.locator('.regenerate-force-btn')).toHaveCount(0);
    } finally {
      await page.close();
    }
  });

  test('CRITICAL: a failing first provider falls through to the second (cross-provider retry)', async ({ context, extensionId }) => {
    test.setTimeout(120_000);
    const consoleLogs: string[] = [];

    await seedConsent(context);

    const page = await openOptionsPage(context, extensionId);
    page.on('console', (m) => consoleLogs.push(`[options ${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => consoleLogs.push(`[OPTIONS_ERROR] ${e.message}`));
    try {
      const client = createDashboardSqliteClient(page);
      await migrationSettled(page, client);
      // Slot 1 (broken model → HTTP 500) must fall through to slot 2.
      await seedAiMockSettings(page, [
        { provider: 'lm-studio', model: 'e2e-mock-model-broken' },
        { provider: 'lm-studio', model: 'e2e-mock-model' },
      ]);

      await seedRows(client, [{
        url: ENTRY_URL,
        title: ENTRY_TITLE,
        summary: OLD_SUMMARY,
        created_at: Date.UTC(2026, 8, 3, 12, 0, 0),
        domain: 'api.openai.com',
      }]);

      await page.locator('[data-panel="panel-sqlite-history"]').click();
      const row = page.locator('#sqlite-entry-list .sqlite-entry', { hasText: ENTRY_TITLE });
      await row.waitFor({ state: 'visible', timeout: 15_000 });
      await row.locator('[data-action="regenerate"]').click();

      const res = await poll(
        () => client.dashboardMsg({ subtype: 'query', domain: 'api.openai.com', limit: 20, offset: 0 } as never),
        (r) => {
          const rows = (r?.['rows'] as Array<{ url?: string; summary?: string }> | undefined) ?? [];
          return rows.some((x) => x.url === ENTRY_URL && (x.summary ?? '').includes('E2E-REGEN-MARKER-9f27'));
        },
        30,
        2000,
      );
      const rows = (res?.['rows'] as Array<{ url?: string; summary?: string }>) ?? [];
      const matches = rows.filter((x) => x.url === ENTRY_URL);
      // The good slot's marker landed on the SAME row (no duplicate) even
      // though the first slot failed.
      expect(matches.length).toBe(1);
      expect(matches[0]!.summary).toContain('E2E-REGEN-MARKER-9f27');
    } finally {
      await page.close();
    }

    if (consoleLogs.length > 0) console.log('Browser console:\n' + consoleLogs.join('\n'));
  });

  test('CRITICAL: total AI failure is non-destructive (old summary kept, error row shown)', async ({ context, extensionId }) => {
    test.setTimeout(120_000);
    const consoleLogs: string[] = [];

    await seedConsent(context);

    const page = await openOptionsPage(context, extensionId);
    page.on('console', (m) => consoleLogs.push(`[options ${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => consoleLogs.push(`[OPTIONS_ERROR] ${e.message}`));
    try {
      const client = createDashboardSqliteClient(page);
      await migrationSettled(page, client);
      // Only a broken slot: every provider fails → aiSucceeded false.
      await seedAiMockSettings(page, [
        { provider: 'lm-studio', model: 'e2e-mock-model-broken' },
      ]);

      await seedRows(client, [{
        url: ENTRY_URL,
        title: ENTRY_TITLE,
        summary: OLD_SUMMARY,
        created_at: Date.UTC(2026, 8, 4, 12, 0, 0),
        domain: 'api.openai.com',
      }]);

      await page.locator('[data-panel="panel-sqlite-history"]').click();
      const row = page.locator('#sqlite-entry-list .sqlite-entry', { hasText: ENTRY_TITLE });
      await row.waitFor({ state: 'visible', timeout: 15_000 });
      await row.locator('[data-action="regenerate"]').click();

      // Failure surfaces in-row (structure only — wording is locale-dependent).
      await expect(row.locator('.regenerate-error-row')).toBeVisible({ timeout: 90_000 });

      // The row was NOT overwritten with an error string, and no duplicate
      // row was created by the failure path.
      const res = await client.dashboardMsg({ subtype: 'query', domain: 'api.openai.com', limit: 20, offset: 0 } as never);
      const rows = (res?.['rows'] as Array<{ url?: string; summary?: string }>) ?? [];
      const matches = rows.filter((x) => x.url === ENTRY_URL);
      expect(matches.length).toBe(1);
      expect(matches[0]!.summary).toBe(OLD_SUMMARY);
    } finally {
      await page.close();
    }

    if (consoleLogs.length > 0) console.log('Browser console:\n' + consoleLogs.join('\n'));
  });
});
