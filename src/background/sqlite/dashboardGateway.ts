// @layer 1 — DashboardGateway (dashboard → service worker hop)
// Extracted from sqliteGateway.ts to give each hop its own locality (PBI 07).

import { errorMessage } from '../../utils/errorUtils.js';
import { categorizeError } from '../../messaging/sqliteRpcClient.js';
import type { SqliteResult } from './offscreenGateway.js';
import { CURRENT_PROTOCOL_VERSION } from '../messageTypes.js';
import { tokenExempt } from '../../messaging/sqliteOperationSecurity.js';
import type { DashboardSqliteRequest, DashboardSqliteResponseFor } from '../handlers/dashboardSqliteProtocol.js';

const DASHBOARD_SQLITE_TIMEOUT = 10000;

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
  async callDashboard<T extends DashboardSqliteRequest, R>(payload: T, decode: (response: Extract<DashboardSqliteResponseFor<T['subtype']>, { success: true }>) => R, defaultErrorMessage: string): Promise<SqliteResult<R>> {
    let response: DashboardSqliteResponseFor<T['subtype']>;
    try { response = await sendDashboard(payload); } catch (error) {
      const classified = categorizeError(errorMessage(error));
      console.error(`${payload.subtype} failed:`, classified.message);
      return { success: false, error: classified };
    }
    if (!response.success) {
      const msg = String((response as { error?: string }).error || defaultErrorMessage);
      console.warn(`${payload.subtype} failed:`, msg);
      const retriable = (response as { retriable?: boolean }).retriable ?? false;
      return { success: false, error: { kind: 'unknown', message: msg, retriable } };
    }
    try { return { success: true, data: decode(response as Extract<DashboardSqliteResponseFor<T['subtype']>, { success: true }>) }; } catch (error) {
      const raw = errorMessage(error);
      console.warn(`${payload.subtype} decode failed:`, raw);
      return { success: false, error: { kind: 'unknown', message: raw, retriable: false } };
    }
  }
}

export const dashboardGateway = new DashboardGateway();
export const DashboardSqliteGateway = DashboardGateway;
