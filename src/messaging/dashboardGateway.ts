// @layer 1 — DashboardGateway (dashboard → service worker hop)
// Extracted from sqliteGateway.ts to give each hop its own locality (PBI 07).
// Moved to messaging/ in PBI 11: the send policy belongs to the dashboard
// developer's view (execution context), not to background/ adjacency.

import { errorMessage } from '../utils/errorUtils.js';
import { backoffDelayMs } from '../utils/backoff.js';
import { categorizeError } from './sqliteRpcClient.js';
import type { SqliteResult } from '../background/sqlite/offscreenGateway.js';
export type { SqliteResult };
import { CURRENT_PROTOCOL_VERSION } from '../background/messageTypes.js';
import { tokenExempt, deriveScopeHash, CONFIRM_TOKEN_MISMATCH_ERROR } from './sqliteOperationSecurity.js';
import type { DashboardSqliteRequest, DashboardSqliteResponseFor } from '../background/handlers/dashboardSqliteProtocol.js';

const DASHBOARD_SQLITE_TIMEOUT = 10000;

export interface DashboardRetryOptions {
  retryAttempts?: number;
  retryDelayMs?: number;
}

async function getDashboardConfirmToken(action: string, id?: number, scopeHash?: string): Promise<string | null> {
  try {
    const requestPayload: DashboardSqliteRequest = {
      subtype: 'create_confirm_token',
      action,
      ...(id !== undefined ? { id } : {}),
      ...(scopeHash !== undefined ? { scopeHash } : {}),
    } as DashboardSqliteRequest;
    const response = await sendDashboardRaw(requestPayload);
    if (response.success && typeof (response as { confirmToken?: string }).confirmToken === 'string') return (response as { confirmToken: string }).confirmToken;
  } catch (error) { console.error('Failed to request dashboard SQLite confirmToken:', error); }
  return null;
}

async function sendDashboardRaw<T extends DashboardSqliteRequest>(payload: T): Promise<DashboardSqliteResponseFor<T['subtype']>> {
  return Promise.race([
    chrome.runtime.sendMessage({ type: 'DASHBOARD_SQLITE', protocolVersion: CURRENT_PROTOCOL_VERSION, payload }),
    new Promise<never>((_, reject) => { setTimeout(() => reject(new Error('Dashboard SQLite request timed out')), DASHBOARD_SQLITE_TIMEOUT); }),
  ]);
}

/**
 * Attach a freshly issued confirmToken to the payload.
 *
 * The scope is re-derived from the payload on every call, so a token obtained
 * here always binds the parameters actually being sent — this is what keeps a
 * re-issue from widening the operation (a token for "archive before Sept 1"
 * can never authorize "archive everything").
 */
async function withConfirmToken<T extends DashboardSqliteRequest>(payload: T): Promise<T & { confirmToken: string }> {
  const action = payload.subtype;
  const id = (payload as unknown as { id?: number }).id;
  const scopeHash = await deriveScopeHash(payload.subtype, payload as Record<string, unknown>);
  const confirmToken = await getDashboardConfirmToken(action, id, scopeHash);
  if (!confirmToken) {
    throw new Error('Dashboard confirm token unavailable');
  }
  // Send-time stability assert (PBI 2026-09-06-01): the token binds the
  // scope derived from the payload at issuance. If the payload object is
  // mutated between token issuance and send, fail closed instead of
  // operating on unexpected parameters.
  if (scopeHash !== undefined) {
    const scopeHashAfter = await deriveScopeHash(payload.subtype, payload as Record<string, unknown>);
    if (scopeHashAfter !== scopeHash) {
      throw new Error('Dashboard SQLite payload changed after confirm token issuance; aborting');
    }
  }
  return { ...payload, confirmToken } as T & { confirmToken: string };
}

function isConfirmTokenMismatch(response: unknown): boolean {
  return (
    typeof response === 'object' &&
    response !== null &&
    (response as { success?: boolean }).success === false &&
    (response as { error?: unknown }).error === CONFIRM_TOKEN_MISMATCH_ERROR
  );
}

async function sendDashboard<T extends DashboardSqliteRequest>(payload: T): Promise<DashboardSqliteResponseFor<T['subtype']>> {
  if (tokenExempt.has(payload.subtype)) {
    // Reuse sendDashboardRaw's single race — the actual send must not build a
    // second parallel timer/message pair (PBI 07: duplicate fetch/race removal).
    return sendDashboardRaw(payload as T & { confirmToken?: string });
  }

  const response = await sendDashboardRaw(await withConfirmToken(payload));
  if (!isConfirmTokenMismatch(response)) return response;

  // The token went missing between issuance and verification. The common cause
  // is not tampering but an MV3 service worker shutdown, which takes
  // chrome.storage.session — and every token in it — with it.
  //
  // Retrying is safe specifically here: the receiver rejects on this path
  // BEFORE running the operation, so nothing has been written and a second
  // attempt cannot double-apply it. The re-issued token re-derives its scope
  // from the same payload, so the retry cannot authorize anything the first
  // attempt could not. One retry only — a second mismatch is a real rejection
  // and is surfaced to the caller.
  return sendDashboardRaw(await withConfirmToken(payload));
}

export class DashboardGateway {
  /**
   * Retry policy contract (PBI 11 — owner is this gateway; moved from the
   * queryLogs/searchLogs-local `withRetry` in dashboardSqliteService):
   * - Opt-in via the 4th argument; without it the call is a single attempt.
   * - An attempt is retried (up to `retryAttempts` total) iff the send throws
   *   or the response is a failure carrying `retriable: true`.
   * - Decode failures are never retried.
   * - Waits `retryDelayMs` (default 1000) between attempts.
   * There is intentionally no subtype → retry-setting policy table; reassess
   * when a third retrying op appears.
   */
  async callDashboard<T extends DashboardSqliteRequest, R>(payload: T, decode: (response: Extract<DashboardSqliteResponseFor<T['subtype']>, { success: true }>) => R, defaultErrorMessage: string, retry?: DashboardRetryOptions): Promise<SqliteResult<R>> {
    const attempts = Math.max(1, retry?.retryAttempts ?? 1);
    const delayMs = retry?.retryDelayMs ?? 1000;
    const waitBetweenAttempts = (attempt: number): Promise<void> =>
      new Promise(resolve => setTimeout(resolve, backoffDelayMs(attempt, { baseMs: delayMs, multiplier: 1 })));
    for (let attempt = 0; attempt < attempts; attempt++) {
      const last = attempt + 1 >= attempts;
      let response: DashboardSqliteResponseFor<T['subtype']>;
      try {
        response = await sendDashboard(payload);
      } catch (error) {
        if (!last) {
          // Constant inter-attempt delay expressed as multiplier 1.
          await waitBetweenAttempts(attempt);
          continue;
        }
        const classified = categorizeError(errorMessage(error));
        console.error(`${payload.subtype} failed:`, classified.message);
        return { success: false, error: classified };
      }
      if (!response.success) {
        const retriable = (response as { retriable?: boolean }).retriable ?? false;
        if (retriable && !last) {
          await waitBetweenAttempts(attempt);
          continue;
        }
        const msg = String((response as { error?: string }).error || defaultErrorMessage);
        console.warn(`${payload.subtype} failed:`, msg);
        return { success: false, error: { kind: 'unknown', message: msg, retriable } };
      }
      try { return { success: true, data: decode(response as Extract<DashboardSqliteResponseFor<T['subtype']>, { success: true }>) }; } catch (error) {
        const raw = errorMessage(error);
        console.warn(`${payload.subtype} decode failed:`, raw);
        return { success: false, error: { kind: 'unknown', message: raw, retriable: false } };
      }
    }
    return { success: false, error: { kind: 'unknown', message: defaultErrorMessage, retriable: false } };
  }
}

export const dashboardGateway = new DashboardGateway();
