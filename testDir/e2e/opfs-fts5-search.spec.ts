/**
 * E2E test: OPFS+FTS5 search persists across reload
 *
 * Seeding approach:
 *   `import` subtype is TOKEN_REQUIRED. The SW generates a confirm token via
 *   ensureConfirmToken() and stores it in chrome.storage.session under
 *   'dashboardSqliteConfirmToken'. We trigger token generation by sending a
 *   no-token-required request first (status), then read the token from
 *   chrome.storage.session inside page.evaluate, and include it in the import
 *   payload. This mirrors what dashboardSqliteService.ts does internally.
 *
 * Dashboard HTML:
 *   WXT outputs dashboard under dist/chromium-mv3/. However, checking the
 *   dist directory shows no dashboard.html at root — the extension uses
 *   options.html for the settings page. We use options.html as the extension
 *   page context to send messages (chrome.runtime is available there).
 */

import { test, expect } from './fixtures/extension.fixture.js';

const CONFIRM_TOKEN_KEY = 'dashboardSqliteConfirmToken';

/**
 * Poll a condition up to maxAttempts times with delayMs between attempts.
 */
async function poll<T>(
  fn: () => Promise<T>,
  check: (v: T) => boolean,
  maxAttempts = 6,
  delayMs = 500
): Promise<T> {
  let last: T;
  for (let i = 0; i < maxAttempts; i++) {
    last = await fn();
    if (check(last)) return last;
    if (i < maxAttempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return last!;
}

test('@extension OPFS+FTS5: seed -> FTS5 search hit -> persists across reload', async ({
  context,
  extensionId,
}) => {
  // Use options.html as the extension page context (has chrome.runtime)
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.waitForFunction(() => typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined');

  const uniqueToken = `uniquefts${Date.now()}`;

  // Step 1: Send a status request first — this triggers ensureConfirmToken()
  // in the SW, which stores the token in chrome.storage.session.
  const status = await poll(
    () =>
      page.evaluate(async () => {
        return (await chrome.runtime.sendMessage({
          type: 'DASHBOARD_SQLITE',
          payload: { subtype: 'status' },
        })) as Record<string, unknown>;
      }),
    (r) => r?.success === true,
    6,
    500
  );
  expect(status?.success).toBe(true);

  // Step 2: Read the confirm token from chrome.storage.session
  const confirmToken = await page.evaluate(
    async (key: string) => {
      const stored = (await chrome.storage.session.get(key)) as Record<string, string | undefined>;
      return stored[key] ?? null;
    },
    CONFIRM_TOKEN_KEY
  );
  expect(confirmToken).not.toBeNull();

  // Step 3: Seed a record via import (token-required).
  // Poll the import until a row is actually inserted: the SQLite worker inits
  // lazily, and when tests share the persistent context the DB may not be ready
  // on the first attempt. A fresh created_at per attempt avoids a permanent
  // INSERT OR IGNORE skip.
  const seed = await poll(
    () =>
      page.evaluate(
        async ({ tok, token }: { tok: string; token: string }) => {
          return (await chrome.runtime.sendMessage({
            type: 'DASHBOARD_SQLITE',
            payload: {
              subtype: 'import',
              confirmToken: token,
              rows: [
                {
                  url: `https://example.com/${tok}`,
                  title: tok,
                  summary: 'fts5 e2e seed',
                  created_at: Date.now(),
                  domain: 'example.com',
                },
              ],
            },
          })) as Record<string, unknown>;
        },
        { tok: uniqueToken, token: confirmToken as string }
      ),
    (r) => r?.success === true && Number(r?.inserted) >= 1,
    8,
    500
  );
  expect(seed?.success).toBe(true);
  expect(Number(seed?.inserted)).toBeGreaterThanOrEqual(1);

  // Step 4: Status reports fts5: true (poll to allow lazy SQLite/WASM init)
  // WASM loading + FTS5 virtual table creation can take several seconds in the
  // offscreen worker, so we poll with a generous timeout (12 × 1s = 12s max).
  const statusAfter = await poll(
    () =>
      page.evaluate(async () => {
        return (await chrome.runtime.sendMessage({
          type: 'DASHBOARD_SQLITE',
          payload: { subtype: 'status' },
        })) as Record<string, unknown>;
      }),
    (r) => r?.success === true && r?.fts5 === true,
    12,
    1000
  );
  expect(statusAfter?.success).toBe(true);
  expect(statusAfter?.fts5).toBe(true);

  // Step 5: FTS5 search finds the seeded record (poll for indexing)
  // The DASHBOARD_SQLITE search response MUST include success:true — the
  // dashboard service (searchLogs) treats a missing success as a load error,
  // which previously produced "データの読み込みに失敗しました" for every query.
  const search1 = await poll(
    () =>
      page.evaluate(async (tok: string) => {
        return (await chrome.runtime.sendMessage({
          type: 'DASHBOARD_SQLITE',
          payload: { subtype: 'search', query: tok },
        })) as Record<string, unknown>;
      }, uniqueToken),
    (r) => r?.success === true && Array.isArray(r?.rows) && Number(r?.total) >= 1,
    6,
    500
  );
  expect(search1?.success).toBe(true);
  expect(Array.isArray(search1?.rows)).toBe(true);
  expect(Number(search1?.total)).toBeGreaterThanOrEqual(1);

  // Step 6: Reload the page — OPFS data must survive
  await page.reload();
  await page.waitForFunction(() => typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined');

  // Step 7: Search still finds the record after reload (persistence check)
  const search2 = await poll(
    () =>
      page.evaluate(async (tok: string) => {
        return (await chrome.runtime.sendMessage({
          type: 'DASHBOARD_SQLITE',
          payload: { subtype: 'search', query: tok },
        })) as Record<string, unknown>;
      }, uniqueToken),
    (r) => Array.isArray(r?.rows) && Number(r?.total) >= 1,
    8,
    500
  );
  expect(Array.isArray(search2?.rows)).toBe(true);
  expect(Number(search2?.total)).toBeGreaterThanOrEqual(1);
});

test('@extension OPFS+FTS5: CJK (Japanese) substring search', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.waitForFunction(() => typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined');

  const stamp = Date.now();
  const jpTitle = `機械学習の入門ガイド${stamp}`;
  const jpQuery = '機械学習';

  // token
  await poll(
    () => page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'DASHBOARD_SQLITE', payload: { subtype: 'status' } })) as Record<string, unknown>),
    (r) => r?.success === true, 6, 500
  );
  const confirmToken = await page.evaluate(async (key: string) => {
    const stored = (await chrome.storage.session.get(key)) as Record<string, string | undefined>;
    return stored[key] ?? null;
  }, CONFIRM_TOKEN_KEY);

  // seed Japanese title (poll until inserted — DB may init lazily / shared context)
  const seed = await poll(
    () =>
      page.evaluate(
        async ({ title, token }: { title: string; token: string }) => {
          return (await chrome.runtime.sendMessage({
            type: 'DASHBOARD_SQLITE',
            payload: {
              subtype: 'import', confirmToken: token,
              rows: [{ url: `https://example.com/jp${Date.now()}-${Math.random()}`, title, summary: '日本語の本文テスト', created_at: Date.now(), domain: 'example.com' }],
            },
          })) as Record<string, unknown>;
        },
        { title: jpTitle, token: confirmToken as string }
      ),
    (r) => r?.success === true && Number(r?.inserted) >= 1,
    8,
    500
  );
  expect(seed?.success).toBe(true);

  // wait for fts5
  await poll(
    () => page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'DASHBOARD_SQLITE', payload: { subtype: 'status' } })) as Record<string, unknown>),
    (r) => r?.fts5 === true, 12, 1000
  );

  // search by Japanese substring (>= 3 chars: trigram MATCH path)
  const search = await poll(
    () => page.evaluate(async (q: string) => (await chrome.runtime.sendMessage({ type: 'DASHBOARD_SQLITE', payload: { subtype: 'search', query: q } })) as Record<string, unknown>, jpQuery),
    (r) => Array.isArray(r?.rows) && Number(r?.total) >= 1, 8, 500
  );
  expect(Number(search?.total)).toBeGreaterThanOrEqual(1);

  // 2-char Japanese query should also find the record via LIKE fallback (trigram needs >= 3 chars)
  const search2char = await poll(
    () => page.evaluate(async () =>
      (await chrome.runtime.sendMessage({ type: 'DASHBOARD_SQLITE', payload: { subtype: 'search', query: '機械' } })) as Record<string, unknown>
    ),
    (r) => Array.isArray(r?.rows) && Number(r?.total) >= 1,
    8, 500
  );
  expect(Number(search2char?.total)).toBeGreaterThanOrEqual(1);
});
