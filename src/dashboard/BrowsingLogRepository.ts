/**
 * BrowsingLogRepository — deep module hiding the 20 thin SQLite proxies
 *
 * 20 shallow functions (queryLogs, searchLogs, toggleStar, deleteLog, ...) each
 * did build payload → sendDashboardMessage → decode → ServiceResult. Adding a
 * query meant writing another 15–30 line wrapper + validator + test.
 *
 * This module collapses them behind one seam: domain methods (query, search,
 * toggleStar, delete, getCount, getStatus) hide token/timeout/categorizeError
 * and the query/search retry loop. New operations are one method, not a new
 * wrapper file.
 *
 * Seam is ports & adapters: OffscreenTransport is the real seam (Chrome prod
 * vs InMemory test). Two adapters justify the seam — one adapter would be
 * hypothetical.
 *
 * Transport is internal: callers never see DashboardSqliteRequest, tokenExempt,
 * or CURRENT_PROTOCOL_VERSION.
 */

import type { DashboardSqliteRequest, DashboardSqliteResponseFor } from '../background/handlers/dashboardSqliteProtocol.js';
import { CURRENT_PROTOCOL_VERSION } from '../background/messageTypes.js';
import { tokenExempt } from '../messaging/sqliteOperationSecurity.js';
import { categorizeError } from '../messaging/sqliteRpcClient.js';
import {
  requiredNonNegativeNumber,
  requiredBoolean,
  requiredString,
  optionalBoolean,
  optionalNullableString,
  optionalNonNegativeNumber,
  isRecord,
  isFiniteNumber,
  requiredRows,
  isBrowsingLogEntry,
  optionalStringArray,
  optionalCompileOptionsSource,
} from '../messaging/sqliteValidators.js';
import { errorMessage } from '../utils/errorUtils.js';
import { pickDefined } from '../utils/objectUtils.js';
import type { BrowsingLogEntry } from '../utils/sqlite-types.js';

export type ServiceResult<T> = { data: T } | { error: string };
export function isServiceError<T>(result: ServiceResult<T>): result is { error: string } {
  return 'error' in result;
}

const DASHBOARD_SQLITE_TIMEOUT = 10000;
const CONFIRM_TOKEN_KEY = 'dashboardSqliteConfirmToken';

async function getConfirmToken(): Promise<string | null> {
  try {
    const stored = (await chrome.storage.session.get(CONFIRM_TOKEN_KEY)) as Record<string, string | undefined>;
    if (stored[CONFIRM_TOKEN_KEY]) return stored[CONFIRM_TOKEN_KEY];
  } catch (e) {
    console.error('Failed to read dashboard SQLite confirmToken:', e);
  }
  try {
    const response = await sendDashboardMessage({ subtype: 'confirm_token' });
    if (response.success && typeof response.confirmToken === 'string') {
      await chrome.storage.session.set({ [CONFIRM_TOKEN_KEY]: response.confirmToken });
      return response.confirmToken;
    }
  } catch (e) {
    console.error('Failed to request dashboard SQLite confirmToken:', e);
  }
  return null;
}

async function withConfirmToken<T extends DashboardSqliteRequest>(payload: T): Promise<T & { confirmToken?: string }> {
  const token = await getConfirmToken();
  return token ? { ...payload, confirmToken: token } : payload;
}

async function sendDashboardMessage<T extends DashboardSqliteRequest>(
  payload: T,
): Promise<DashboardSqliteResponseFor<T['subtype']>> {
  const requireConfirmToken = !tokenExempt.has(payload.subtype);
  const messagePayload = requireConfirmToken ? await withConfirmToken(payload) : payload;
  return Promise.race([
    chrome.runtime.sendMessage({
      type: 'DASHBOARD_SQLITE',
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      payload: messagePayload,
    }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Dashboard SQLite request timed out')), DASHBOARD_SQLITE_TIMEOUT)),
  ]);
}

async function callDashboard<T extends DashboardSqliteRequest, R>(
  payload: T,
  decode: (response: Extract<DashboardSqliteResponseFor<T['subtype']>, { success: true }>) => R,
  defaultErrorMessage: string,
): Promise<ServiceResult<R>> {
  let response: DashboardSqliteResponseFor<T['subtype']>;
  try {
    response = await sendDashboardMessage(payload);
  } catch (error) {
    const classified = categorizeError(errorMessage(error)).message;
    console.error(`${payload.subtype} failed:`, classified);
    return { error: classified };
  }
  if (!response.success) {
    console.warn(`${payload.subtype} failed:`, String(response.error || 'Unknown error'));
    return { error: String(response.error || defaultErrorMessage) };
  }
  try {
    return { data: decode(response) };
  } catch (error) {
    const raw = errorMessage(error);
    console.warn(`${payload.subtype} decode failed:`, raw);
    return { error: raw };
  }
}

/**
 * Deep repository: 6 domain methods hide the 20 thin proxies.
 * New callers should depend on this seam; the old dashboardSqliteService.ts
 * remains as a re-export shim for transition.
 */
export class BrowsingLogRepository {
  /**
   * Query browsing logs with filters. Retries once on transient failure
   * (SQLite init race). This retry loop is the reason query/search don't use
   * the generic callDashboard single-attempt path.
   */
  async query(options: {
    limit?: number;
    offset?: number;
    domain?: string;
    isStarred?: boolean;
    since?: number;
    until?: number;
    orderBy?: string;
    orderDir?: 'ASC' | 'DESC';
    tagFilter?: string;
  } = {}): Promise<ServiceResult<{ rows: BrowsingLogEntry[]; total: number }>> {
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: DashboardSqliteResponseFor<'query'>;
      try {
        response = await sendDashboardMessage({ subtype: 'query', ...options });
      } catch (error) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        const classified = categorizeError(errorMessage(error)).message;
        console.error('queryLogs failed:', classified);
        return { error: classified };
      }
      if (response.success) {
        try {
          return {
            data: {
              rows: requiredRows(response.rows, 'rows', isBrowsingLogEntry),
              total: requiredNonNegativeNumber(response.total, 'total'),
            },
          };
        } catch (error) {
          const raw = errorMessage(error);
          console.warn('queryLogs decode failed:', raw);
          return { error: raw };
        }
      }
      if (attempt === 0 && response.retriable) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      console.warn('queryLogs failed:', String(response.error || 'Unknown error'));
      return { error: String(response.error || 'Query failed') };
    }
    return { error: 'Query failed' };
  }

  async search(
    query: string,
    limit = 50,
    offset = 0,
    options: { orderBy?: 'rank' | 'created_at'; orderDir?: 'ASC' | 'DESC' } = {},
  ): Promise<ServiceResult<{ rows: BrowsingLogEntry[]; total: number }>> {
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: DashboardSqliteResponseFor<'search'>;
      try {
        response = await sendDashboardMessage({
          subtype: 'search',
          query,
          limit,
          offset,
          ...pickDefined({ orderBy: options.orderBy, orderDir: options.orderDir }),
        });
      } catch (error) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        const classified = categorizeError(errorMessage(error)).message;
        console.error('searchLogs failed:', classified);
        return { error: classified };
      }
      if (response.success) {
        try {
          return {
            data: {
              rows: requiredRows(response.rows, 'rows', isBrowsingLogEntry),
              total: requiredNonNegativeNumber(response.total, 'total'),
            },
          };
        } catch (error) {
          const raw = errorMessage(error);
          console.warn('searchLogs decode failed:', raw);
          return { error: raw };
        }
      }
      if (attempt === 0 && response.retriable) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      console.warn('searchLogs failed:', String(response.error || 'Unknown error'));
      return { error: String(response.error || 'Search failed') };
    }
    return { error: 'Search failed' };
  }

  async toggleStar(id: number): Promise<ServiceResult<{ is_starred: number }>> {
    return callDashboard(
      { subtype: 'toggle_star', id },
      (r) => ({ is_starred: requiredNonNegativeNumber(r.is_starred, 'is_starred') }),
      'Toggle star failed',
    );
  }

  async deleteLog(id: number): Promise<ServiceResult<void>> {
    return callDashboard({ subtype: 'delete', id }, () => undefined, 'Delete failed');
  }

  async getCount(): Promise<ServiceResult<number>> {
    return callDashboard(
      { subtype: 'get_count' },
      (r) => requiredNonNegativeNumber(r.count, 'count'),
      'Get count failed',
    );
  }

  async getStatus(): Promise<{
    initialized: boolean;
    path: string;
    fallback: boolean;
    fts5: boolean;
    compileOptions?: string[];
    compileOptionsSource?: 'opfs-worker' | 'idb' | 'fallback';
    initError?: string;
    opfsMigrationV2Done?: boolean;
    opfsMigrationV2LastAttemptedAt?: string | null;
    opfsMigrationV2CompletedAt?: string | null;
    opfsMigrationV2RecordCount?: number;
  }> {
    let response: DashboardSqliteResponseFor<'status'>;
    try {
      response = await sendDashboardMessage({ subtype: 'status' });
    } catch (error) {
      const classified = categorizeError(errorMessage(error)).message;
      return { initialized: false, path: '', fallback: false, fts5: false, initError: classified };
    }
    if (response.success) {
      try {
        return {
          initialized: requiredBoolean(response.initialized, 'initialized'),
          path: requiredString(response.path, 'path'),
          fallback: requiredBoolean(response.fallback, 'fallback'),
          fts5: requiredBoolean(response.fts5, 'fts5'),
          ...pickDefined({
            compileOptions: optionalStringArray(response.compileOptions, 'compileOptions'),
            compileOptionsSource: optionalCompileOptionsSource(response.compileOptionsSource),
            initError: response.initError ? String(response.initError) : undefined,
            opfsMigrationV2Done: optionalBoolean(response.opfsMigrationV2Done, 'opfsMigrationV2Done'),
            opfsMigrationV2LastAttemptedAt: optionalNullableString(response.opfsMigrationV2LastAttemptedAt, 'opfsMigrationV2LastAttemptedAt'),
            opfsMigrationV2CompletedAt: optionalNullableString(response.opfsMigrationV2CompletedAt, 'opfsMigrationV2CompletedAt'),
            opfsMigrationV2RecordCount: optionalNonNegativeNumber(response.opfsMigrationV2RecordCount, 'opfsMigrationV2RecordCount'),
          }),
        };
      } catch (error) {
        return { initialized: false, path: '', fallback: false, fts5: false, initError: errorMessage(error) };
      }
    }
    return {
      initialized: false,
      path: '',
      fallback: false,
      fts5: false,
      initError: String(response.error || 'Failed to get SQLite status'),
    };
  }
}

// Default singleton for callers that don't need DI
export const browsingLogRepository = new BrowsingLogRepository();
