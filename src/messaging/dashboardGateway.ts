// @layer 1 — DashboardGateway (dashboard → service worker hop)
// Extracted from sqliteGateway.ts to give each hop its own locality (PBI 07).
// Moved to messaging/ in PBI 11: the send policy belongs to the dashboard
// developer's view (execution context), not to background/ adjacency.

import { errorMessage } from '../utils/errorUtils.js';
import { categorizeError } from './sqliteRpcClient.js';
import type { SqliteResult } from '../background/sqlite/offscreenGateway.js';
export type { SqliteResult };
import { CURRENT_PROTOCOL_VERSION } from '../background/messageTypes.js';
import { tokenExempt } from './sqliteOperationSecurity.js';
import type { DashboardSqliteRequest, DashboardSqliteResponseFor } from '../background/handlers/dashboardSqliteProtocol.js';

const DASHBOARD_SQLITE_TIMEOUT = 10000;

export interface DashboardRetryOptions {
  retryAttempts?: number;
  retryDelayMs?: number;
}

async function getDashboardConfirmToken(action: string, id?: number): Promise<string | null> {
  try {
    const requestPayload: DashboardSqliteRequest = { subtype: 'create_confirm_token', action, ...(id !== undefined ? { id } : {}) } as DashboardSqliteRequest;
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

async function sendDashboard<T extends DashboardSqliteRequest>(payload: T): Promise<DashboardSqliteResponseFor<T['subtype']>> {
  const requireConfirmToken = !tokenExempt.has(payload.subtype);
  let messagePayload: T & { confirmToken?: string } = payload as T & { confirmToken?: string };
  if (requireConfirmToken) {
    const action = payload.subtype;
    const id = (payload as unknown as { id?: number }).id;
    const confirmToken = await getDashboardConfirmToken(action, id);
    if (!confirmToken) {
      throw new Error('Dashboard confirm token unavailable');
    }
    messagePayload = { ...payload, confirmToken } as T & { confirmToken: string };
  }
  // Reuse sendDashboardRaw's single race — the actual send must not build a
  // second parallel timer/message pair (PBI 07: duplicate fetch/race removal).
  return sendDashboardRaw(messagePayload);
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
    for (let attempt = 0; attempt < attempts; attempt++) {
      const last = attempt + 1 >= attempts;
      let response: DashboardSqliteResponseFor<T['subtype']>;
      try {
        response = await sendDashboard(payload);
      } catch (error) {
        if (!last) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
        const classified = categorizeError(errorMessage(error));
        console.error(`${payload.subtype} failed:`, classified.message);
        return { success: false, error: classified };
      }
      if (!response.success) {
        const retriable = (response as { retriable?: boolean }).retriable ?? false;
        if (retriable && !last) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
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
export const DashboardSqliteGateway = DashboardGateway;
