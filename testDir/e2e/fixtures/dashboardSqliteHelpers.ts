/**
 * dashboardSqliteHelpers.ts — shared DASHBOARD_SQLITE test client for @extension
 * specs (PBI 2026-09-07-01/02, shared setup helpers: 2026-09-07-06).
 *
 * Mirrors the in-page derivation used by dashboardGateway: the confirm token's
 * scopeHash is SHA-256 over `parts.map(String).join('|')`, computed on the
 * extension page itself (the SW re-derives the same hash from the payload).
 * Ops without a scope (e.g. import) must omit the hash entirely — sending one
 * fails the strict compare on the SW side.
 */
import { expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

type Payload = Record<string, unknown>;

export interface DashboardSqliteClient {
  dashboardMsg: (payload: Payload) => Promise<Record<string, unknown>>;
  scopeHash: (parts: Array<string | number | boolean | undefined | null>) => Promise<string>;
  tokenFor: (
    action: string,
    scopeParts: Array<string | number | boolean | undefined | null>,
    id?: number,
  ) => Promise<string>;
}

/** Open the extension options page and wait for the runtime bridge to be up. */
export async function openOptionsPage(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.waitForFunction(() => typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined');
  return page;
}

/**
 * Settle the deferred legacy migration BEFORE seeding the legacy store.
 *
 * `runDeferredStartupMigrations` (service-worker.ts) runs once, right before
 * the first message handler invocation. On a fresh profile it sees an empty
 * `savedUrlsWithTimestamps`, marks fresh_install and sets the
 * `legacyStoreReadOnly` flag. Tests that seed the legacy store BEFORE that
 * point would have their entries migrated into SQLite (silently doubling
 * counts). This helper forces the migration to run while the store is still
 * empty, waits for the flag, then seals the migration path so later
 * `chrome.storage.local` seeds are left alone.
 */
export async function migrationSettled(page: Page, client: DashboardSqliteClient): Promise<void> {
  // First DASHBOARD_SQLITE message triggers the deferred runner.
  await client.dashboardMsg({ subtype: 'get_count' });
  await expect(async () => {
    const flag = await page.evaluate(() => chrome.storage.local.get('legacyStoreReadOnly'));
    if (!flag.legacyStoreReadOnly) throw new Error('deferred migration not settled yet');
  }).toPass({ timeout: 20_000, intervals: [500] });
  await page.evaluate(() => chrome.storage.local.set({ yasumaro_migration_status: 'completed' }));
}

export function createDashboardSqliteClient(page: Page): DashboardSqliteClient {
  const dashboardMsg = (payload: Payload) =>
    page.evaluate(async (p) => {
      return (await chrome.runtime.sendMessage({ type: 'DASHBOARD_SQLITE', payload: p })) as Record<string, unknown>;
    }, payload);

  const scopeHash = (parts: Array<string | number | undefined | null>) =>
    page.evaluate(async (joined: string) => {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(joined));
      return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }, parts.map((p) => (p === undefined || p === null ? '' : String(p))).join('|'));

  const tokenFor = async (
    action: string,
    scopeParts: Array<string | number | undefined | null>,
    id?: number,
  ): Promise<string> => {
    // Mirrors dashboardGateway.sendDashboard: the token binds (action, id,
    // scopeHash). Ops whose payload carries an id (e.g. archive_update) must
    // issue the token with that same id, and non-archive actions derive no
    // scope on the SW side — sending a hash there would fail the strict
    // compare, so it is omitted instead.
    const tokenScopeHash = scopeParts.length > 0 ? await scopeHash(scopeParts) : undefined;
    const res = await dashboardMsg({
      subtype: 'create_confirm_token',
      action,
      ...(id !== undefined ? { id } : {}),
      ...(tokenScopeHash !== undefined ? { scopeHash: tokenScopeHash } : {}),
    });
    if (!res.success) throw new Error(`create_confirm_token failed: ${JSON.stringify(res)}`);
    return res.confirmToken as string;
  };

  return { dashboardMsg, scopeHash, tokenFor };
}

/**
 * Seed rows via the `import` subtype. Resending is idempotent: the UNIQUE
 * constraint skips duplicates, so the poll-retry pattern is safe — PROVIDED
 * `created_at` is a fixed value (use `Date.UTC(...)`). Runtime-dependent
 * timestamps (`Date.now()`) would insert a new row on every retry.
 */
export async function seedRows(
  client: Pick<DashboardSqliteClient, 'dashboardMsg' | 'tokenFor'>,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  const seedToken = await client.tokenFor('import', []);
  const seed = await poll(
    () => client.dashboardMsg({ subtype: 'import', confirmToken: seedToken, rows }),
    (r) => r?.success === true && Number(r?.inserted) >= rows.length,
  );
  expect(seed?.success, `import failed: ${JSON.stringify(seed)}`).toBe(true);
}

/** `YYYY-MM-DD` for `days` from now (local calendar). */
export function isoDateOffset(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Phase A (archive create) with a local-date cutoff. Returns the staging. */
export async function runPhaseA(
  page: Page,
  client: DashboardSqliteClient,
  cutoffDate: string,
  includeDeleted = false,
): Promise<{ stagingName: string; recordCount: number }> {
  const cutoffMs = await localEndOfDayMs(page, cutoffDate);
  const token = await client.tokenFor('archive_create', [cutoffMs, includeDeleted]);
  const res = await client.dashboardMsg({
    subtype: 'archive_create',
    cutoffDate,
    cutoffMs,
    includeDeleted,
    yasumaroVersion: '6.7.114',
    confirmToken: token,
    scopeHash: await client.scopeHash([cutoffMs, includeDeleted]),
  });
  expect(res.success, `archive_create failed: ${JSON.stringify(res)}`).toBe(true);
  return { stagingName: res.stagingName as string, recordCount: Number(res.recordCount) };
}

/** Poll `fn` until `check` passes or attempts run out (last value returned). */
export async function poll<T>(
  fn: () => Promise<T>,
  check: (v: T) => boolean,
  maxAttempts = 8,
  delayMs = 500,
): Promise<T> {
  let last: T;
  for (let i = 0; i < maxAttempts; i++) {
    last = await fn();
    if (check(last)) return last;
    if (i < maxAttempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return last!;
}

/** Local end-of-day epoch for a `YYYY-MM-DD` string, computed in the page's
 * own timezone (mirrors cutoffMsFromLocalDate / the dashboard sender). */
export function localEndOfDayMs(page: Page, cutoffDate: string): Promise<number> {
  return page.evaluate((date: string) => {
    const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
    return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
  }, cutoffDate);
}
