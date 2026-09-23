import { test, expect } from './fixtures/extension.fixture.js';
import {
  openOptionsPage,
  createDashboardSqliteClient,
  poll,
} from './fixtures/dashboardSqliteHelpers.js';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';

/**
 * PBI 05 ① candidate-floor guard — real-content-script recording e2e.
 *
 * The jsdom fixture tests (src/utils/contentExtractor/__tests__/overcutFixtures.test.ts)
 * are the hard DoD gate for extraction semantics (Ask N2-A). This spec proves
 * the SAME guard code runs end-to-end inside the real content script:
 *   - VALID_VISIT fires on the fixture page
 *   - legacy metadata (dual-write, default ON) carries fallbackTriggered=true
 *     and floor-clearing content (the 193 B legacy fragment must not ship)
 *   - the pipeline saved a SQLite row (no regression from the guard annotation)
 *
 * WHY a picked permitted port: the manifest host_permissions only cover the
 * four AI/obsidian loopback ports (11434, 27123, 27124, 1234) but NOT
 * localhost:8080 — without a matching host permission sender.tab.url is
 * hidden from the SW and ValidVisitHandler records url:'' (rejected). Any of
 * the four can be occupied on a dev machine (1234 = the real LM Studio app),
 * so the spec probe-and-picks the first free one (fixtures/localServers.ts).
 * Serving the fixture on a permitted port keeps the production manifest
 * untouched.
 */

import { pickLoopbackPort, listenHttp } from './fixtures/localServers.js';

let FIXTURE_PORT: number;
let FIXTURE_URL: string;
const PAGES_DIR = join(process.cwd(), 'testDir/e2e/test-pages');
// Must match PRIVACY_POLICY_VERSION in src/utils/storage/privacyConsent.ts —
// a mismatch keeps PRIVACY_CONSENT false and VALID_VISIT is rejected with
// 'privacy_consent_required' (same trap as recording-traceId.spec.ts).
const PRIVACY_POLICY_VERSION = '2026-07-31';

let fixtureServer: Server | undefined;

test.beforeAll(async () => {
  FIXTURE_PORT = await pickLoopbackPort();
  FIXTURE_URL = `http://127.0.0.1:${FIXTURE_PORT}/qa-smbc-repro.html`;
  fixtureServer = createServer((req, res) => {
    const pathOnly = (req.url || '/').split('?')[0] || '/';
    const resolved = normalize(join(PAGES_DIR, pathOnly === '/' ? 'qa-smbc-repro.html' : pathOnly));
    if (!resolved.startsWith(PAGES_DIR + sep)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Bad Request');
      return;
    }
    try {
      const body = readFileSync(resolved);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });
  // Await the bind: a fire-and-forget listen() races the first goto.
  await listenHttp(fixtureServer, FIXTURE_PORT);
});

test.afterAll(() => {
  fixtureServer?.close();
  fixtureServer = undefined;
});

function readTestState(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const attr = document.documentElement.getAttribute('data-ow-test-state');
    if (!attr) return null;
    return JSON.parse(attr) as {
      maxScrollPercentage: number;
      isValidVisitReported: boolean;
      startTime: number;
      minVisitDuration: number;
      minScrollDepth: number;
      duration: number;
    };
  });
}

/** extractor 初期化（data-ow-test-state 属性設定）を待機 */
async function waitForExtractorInit(page: import('@playwright/test').Page, timeout = 10000) {
  await expect(() =>
    page.evaluate(() => {
      const attr = document.documentElement.getAttribute('data-ow-test-state');
      if (!attr) throw new Error('data-ow-test-state not yet set');
      return JSON.parse(attr);
    })
  ).toPass({ timeout });
}

test.describe('Over-cut Guard Recording @extension', () => {
  test('① guard fires in the real content script: floor-clearing content is shipped and saved', async ({ context, extensionId }) => {
    const consoleLogs: string[] = [];

    await test.step('Grant privacy consent so the SW processes the recording', async () => {
      const sw = context.serviceWorkers()[0];
      expect(sw, 'service worker must be running').toBeTruthy();
      await sw.evaluate(async (version: string) => {
        await chrome.storage.local.set({
          privacy_consent: { hasConsented: true, consentVersion: version, consentDate: Date.now() },
          privacy_consent_version: version,
          settings_migrated: true,
        });
      }, PRIVACY_POLICY_VERSION);
    });

    const page = await context.newPage();
    page.on('console', (msg) => consoleLogs.push(`[page ${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => consoleLogs.push(`[PAGE_ERROR] ${err.message}`));

    await page.goto(FIXTURE_URL);
    await waitForExtractorInit(page);

    await test.step('Scroll to bottom → isValidVisitReported', async () => {
      await page.evaluate(async () => {
        const h = document.body.scrollHeight;
        for (let y = 0; y <= h; y += 400) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 30));
        }
        window.scrollTo(0, h);
      });
      await expect(async () => {
        const state = await readTestState(page);
        expect(state).not.toBeNull();
        expect(state!.isValidVisitReported).toBe(true);
      }).toPass({ timeout: 20000, intervals: [500] });
    });

    await test.step('Legacy metadata: fallbackTriggered=true and content ≥ 100 chars', async () => {
      // chrome.storage is only exposed on extension pages — read from options.
      const optionsPage = await openOptionsPage(context, extensionId);
      try {
        const entry = await poll(
          async () => {
            const stored = await optionsPage.evaluate(async () => {
              const res = await chrome.storage.local.get('savedUrlsWithTimestamps');
              return (res.savedUrlsWithTimestamps as Array<Record<string, unknown>>) ?? [];
            });
            return stored.find((e) => e['url'] === FIXTURE_URL);
          },
          (e) => e !== undefined,
          10,
          1000,
        );
        expect(
          entry,
          `legacy metadata for fixture URL missing. console:\n${consoleLogs.join('\n')}`,
        ).toBeDefined();
        expect(entry!['fallbackTriggered']).toBe(true);
        // レガシーの193B断片送出を回帰検出: 送信本文はフロアを満たす
        expect(
          String(entry!['content'] ?? '').length,
          `stored entry: ${JSON.stringify(entry).slice(0, 1200)}\npage console:\n${consoleLogs.join('\n')}`,
        ).toBeGreaterThanOrEqual(100);
        expect(String(entry!['content'] ?? '')).toContain('Oliveのランク切替方法');
      } finally {
        await optionsPage.close();
      }
    });

    await test.step('SQLite row was saved by the pipeline (guard annotation did not break saving)', async () => {
      const optionsPage = await openOptionsPage(context, extensionId);
      try {
        const client = createDashboardSqliteClient(optionsPage);
        const res = await poll(
          () => client.dashboardMsg({ subtype: 'query', limit: 20, offset: 0 } as never),
          (r) =>
            r?.success === true &&
            ((r['rows'] as Array<{ url?: string }>) ?? []).some((row) => row.url === FIXTURE_URL),
          10,
          1000,
        );
        const rows = (res['rows'] as Array<{ url: string }>) ?? [];
        expect(
          rows.some((row) => row.url === FIXTURE_URL),
          `sqlite row missing: ${JSON.stringify(res)}\nconsole:\n${consoleLogs.join('\n')}`,
        ).toBe(true);
      } finally {
        await optionsPage.close();
      }
    });

    if (consoleLogs.length > 0) {
      console.log('Browser console:\n' + consoleLogs.join('\n'));
    }
    await page.close();
  });
});
