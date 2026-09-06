/**
 * dashboardSqliteHelpers.ts — shared DASHBOARD_SQLITE test client for @extension
 * specs (PBI 2026-09-07-01/02).
 *
 * Mirrors the in-page derivation used by dashboardGateway: the confirm token's
 * scopeHash is SHA-256 over `parts.map(String).join('|')`, computed on the
 * extension page itself (the SW re-derives the same hash from the payload).
 * Ops without a scope (e.g. import) must omit the hash entirely — sending one
 * fails the strict compare on the SW side.
 */
import type { Page } from '@playwright/test';

type Payload = Record<string, unknown>;

export interface DashboardSqliteClient {
  dashboardMsg: (payload: Payload) => Promise<Record<string, unknown>>;
  scopeHash: (parts: Array<string | number | undefined | null>) => Promise<string>;
  tokenFor: (
    action: string,
    scopeParts: Array<string | number | undefined | null>,
    id?: number,
  ) => Promise<string>;
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
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
  }, cutoffDate);
}
