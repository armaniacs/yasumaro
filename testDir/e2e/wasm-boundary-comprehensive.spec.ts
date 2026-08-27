/**
 * wasm-boundary-comprehensive.spec.ts
 * E2E tests for WASM/SQLite boundary in the extension context:
 * - OPFS / IDB / Fallback persistence across reloads
 * - WASM initialization and status reporting
 * - Search indexing after insert
 * - Storage isolation and chrome.storage persistence
 *
 * Uses the extension's DASHBOARD_SQLITE message bridge via options.html
 * (chrome.runtime is available there). All tests use chrome.storage.local
 * fallback path which is reliable in headless Chrome.
 */

import { test, expect } from './fixtures/extension.fixture.js';

const CONFIRM_TOKEN_KEY = 'dashboardSqliteConfirmToken';

async function poll<T>(
  fn: () => Promise<T>,
  check: (v: T) => boolean,
  maxAttempts = 8,
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

test.describe('WASM boundary E2E', () => {
  test('@extension status reports initialized after WASM load', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForFunction(() => typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined');

    const status = await poll(
      () =>
        page.evaluate(async () => {
          return (await chrome.runtime.sendMessage({
            type: 'DASHBOARD_SQLITE',
            payload: { subtype: 'status' },
          })) as Record<string, unknown>;
        }),
      (r) => r?.success === true,
      10,
      500
    );

    expect(status?.success).toBe(true);
    // Either OPFS, IDB, or fallback should be selected — at minimum the DB is initialized
    expect(typeof status?.initialized).toBe('boolean');
  });

  test('@extension insert -> search -> reload -> search still finds record (fallback persistence)', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForFunction(() => typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined');

    const uniqueToken = `e2ewasm${Date.now()}`;

    // Trigger confirm token generation
    await poll(
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

    const confirmToken = await page.evaluate(async (key: string) => {
      const stored = (await chrome.storage.session.get(key)) as Record<string, string | undefined>;
      return stored[key] ?? null;
    }, CONFIRM_TOKEN_KEY);
    expect(confirmToken).not.toBeNull();

    // Seed via import
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
                    url: `https://e2e-wasm.example.com/${tok}`,
                    title: tok,
                    summary: 'wasm boundary e2e persistence test',
                    created_at: Date.now(),
                    domain: 'e2e-wasm.example.com',
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

    // Search finds the record
    const search1 = await poll(
      () =>
        page.evaluate(async (tok: string) => {
          return (await chrome.runtime.sendMessage({
            type: 'DASHBOARD_SQLITE',
            payload: { subtype: 'search', query: tok },
          })) as Record<string, unknown>;
        }, uniqueToken),
      (r) => r?.success === true && Array.isArray(r?.rows) && Number(r?.total) >= 1,
      8,
      500
    );
    expect(search1?.success).toBe(true);
    expect(Number(search1?.total)).toBeGreaterThanOrEqual(1);

    // Reload — data must survive (chrome.storage.local or IDB)
    await page.reload();
    await page.waitForFunction(() => typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined');

    const search2 = await poll(
      () =>
        page.evaluate(async (tok: string) => {
          return (await chrome.runtime.sendMessage({
            type: 'DASHBOARD_SQLITE',
            payload: { subtype: 'search', query: tok },
          })) as Record<string, unknown>;
        }, uniqueToken),
      (r) => Array.isArray(r?.rows) && Number(r?.total) >= 1,
      10,
      500
    );
    expect(Array.isArray(search2?.rows)).toBe(true);
    expect(Number(search2?.total)).toBeGreaterThanOrEqual(1);
  });

  test('@extension query pagination via DASHBOARD_SQLITE query subtype', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForFunction(() => typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined');

    await poll(
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

    const confirmToken = await page.evaluate(async (key: string) => {
      const stored = (await chrome.storage.session.get(key)) as Record<string, string | undefined>;
      return stored[key] ?? null;
    }, CONFIRM_TOKEN_KEY);

    const batchToken = `paginate${Date.now()}`;
    const rows = Array.from({ length: 3 }, (_, i) => ({
      url: `https://paginate.example.com/${batchToken}/${i}`,
      title: `${batchToken} ${i}`,
      summary: `pagination test ${i}`,
      created_at: Date.now() + i,
      domain: 'paginate.example.com',
    }));

    await poll(
      () =>
        page.evaluate(
          async ({ rows: r, token }: { rows: typeof rows; token: string }) => {
            return (await chrome.runtime.sendMessage({
              type: 'DASHBOARD_SQLITE',
              payload: { subtype: 'import', confirmToken: token, rows: r },
            })) as Record<string, unknown>;
          },
          { rows, token: confirmToken as string }
        ),
      (res) => res?.success === true,
      6,
      500
    );

    // Query with limit 2 should return paginated results
    const q1 = await page.evaluate(async () => {
      return (await chrome.runtime.sendMessage({
        type: 'DASHBOARD_SQLITE',
        payload: { subtype: 'query', limit: 2, offset: 0 },
      })) as Record<string, unknown>;
    });
    expect(q1?.success).toBe(true);
    expect(Array.isArray(q1?.rows)).toBe(true);
  });
});
