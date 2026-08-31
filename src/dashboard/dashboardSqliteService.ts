/**
 * dashboardSqliteService.ts
 * Provides SQLite-backed data access for the dashboard via SW message passing.
 * The service worker's DASHBOARD_SQLITE handler proxies requests to SqliteClient.
 */

import type { DashboardSqliteRequest, DashboardSqliteResponseFor } from '../background/handlers/dashboardSqliteProtocol.js';
import { CURRENT_PROTOCOL_VERSION } from '../background/messageTypes.js';
import { tokenExempt } from '../messaging/sqliteOperationSecurity.js';
import { categorizeError } from '../messaging/sqliteRpcClient.js';
// PBI-05: unified SqliteResult vocabulary — both hops now share the same
// error classification and result shape via SqliteGateway.
import { dashboardGateway, type SqliteResult } from '../background/sqliteGateway.js';
import { bytesToBase64, base64ToBytes } from '../utils/crypto/index.js';
import { pickDefined } from '../utils/objectUtils.js';
import {
  requiredNonNegativeNumber,
  requiredBoolean,
  requiredString,
  isRecord,
  isFiniteNumber,
  requiredRows,
  isBrowsingLogEntry,
  isAuditLogEntry,
  decodeStatusExtras,
} from '../messaging/sqliteValidators.js';

const DASHBOARD_SQLITE_TIMEOUT = 10000;

/**
 * The uniform failure shape for this module.
 *
 * The same "it failed" used to arrive as `null`, `false`, `-1` or `{error}`
 * depending on which function you happened to call, so every call site had to
 * remember a different idiom — and the three silent shapes carried no reason
 * to show the user.
 *
 * The success side is `{ data }` rather than `{ ok: true, data }` to match the
 * `{ ... } | { error }` functions that PBI-19/21 already migrated; adding an
 * `ok` discriminant here would have made a third idiom instead of removing one.
 *
 * PBI-05: the error strings themselves now come from the same
 * `categorizeError()` that SqliteClient uses, so dashboard callers and the
 * Service Worker agree on wording and retry hints. ServiceResult is now a
 * mapped view over the unified SqliteResult<T>.
 */
export type ServiceResult<T> = { data: T } | { error: string };
/** Unified gateway result — re-exported so dashboard and SW share vocabulary. */
export type { SqliteResult };
function toServiceResult<T>(r: SqliteResult<T>): ServiceResult<T> {
  return r.success ? { data: r.data } : { error: r.error.message };
}

/** Narrowing helper so call sites do not each re-derive the check. */
export function isServiceError<T>(result: ServiceResult<T>): result is { error: string } {
  return 'error' in result;
}

/**
 * Request a per-action single-use confirm token (60s TTL) from the service worker.
 * Each destructive operation gets its own token bound to action/id.
 */
async function getConfirmTokenForAction(action: string, id?: number): Promise<string | null> {
  try {
    const requestPayload: DashboardSqliteRequest = { subtype: 'create_confirm_token', action, ...(id !== undefined ? { id } : {}) } as DashboardSqliteRequest;
    const response = await sendDashboardMessageRaw(requestPayload);
    if (response.success && typeof (response as { confirmToken?: string }).confirmToken === 'string') {
      return (response as { confirmToken: string }).confirmToken;
    }
  } catch (error) {
    console.error('Failed to request dashboard SQLite confirmToken:', error);
  }
  return null;
}

async function withConfirmToken<T extends DashboardSqliteRequest>(payload: T): Promise<T & { confirmToken?: string }> {
  const action = payload.subtype;
  const id = (payload as unknown as { id?: number }).id;
  const confirmToken = await getConfirmTokenForAction(action, id);
  return confirmToken ? { ...payload, confirmToken } : payload;
}

/**
 * Low-level send without token injection (used to fetch the token itself).
 */
async function sendDashboardMessageRaw<T extends DashboardSqliteRequest>(
  payload: T,
): Promise<DashboardSqliteResponseFor<T['subtype']>> {
  return Promise.race([
    chrome.runtime.sendMessage({ type: 'DASHBOARD_SQLITE', protocolVersion: CURRENT_PROTOCOL_VERSION, payload }),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Dashboard SQLite request timed out')), DASHBOARD_SQLITE_TIMEOUT);
    }),
  ]);
}

async function sendDashboardMessage<T extends DashboardSqliteRequest>(
  payload: T,
): Promise<DashboardSqliteResponseFor<T['subtype']>> {
  // Fail-safe default: a token is required unless the operation is explicitly
  // in the read-only exempt set (single-sourced in messaging/). A forgotten or
  // new operation therefore fails closed (over-rejects) rather than silently
  // skipping the guard. The receiver enforces this independently, so the sender
  // only decides whether to fetch and attach the token.
  const requireConfirmToken = !tokenExempt.has(payload.subtype);
  const messagePayload = requireConfirmToken
    ? await withConfirmToken(payload)
    : payload;

  return Promise.race([
    chrome.runtime.sendMessage({ type: 'DASHBOARD_SQLITE', protocolVersion: CURRENT_PROTOCOL_VERSION, payload: messagePayload }),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Dashboard SQLite request timed out')), DASHBOARD_SQLITE_TIMEOUT);
    }),
  ]);
}

/**
 * Generic wrapper for the common "send → on success decode+validate the
 * response, on failure/exception surface the reason" pattern shared by most
 * DASHBOARD_SQLITE API functions.
 *
 * Not every function fits this shape — retrying functions (queryLogs,
 * searchLogs) and non-ServiceResult functions (getSqliteStatus) implement
 * their own logic instead of calling this (PBI-39).
 *
 * PBI-05: delegates to DashboardSqliteGateway so the two RPC stacks share
 * the same SqliteResult vocabulary and error classification.
 */
async function callDashboard<T extends DashboardSqliteRequest, R>(
  payload: T,
  decode: (response: Extract<DashboardSqliteResponseFor<T['subtype']>, { success: true }>) => R,
  defaultErrorMessage: string,
): Promise<ServiceResult<R>> {
  const result = await dashboardGateway.callDashboard(payload, decode, defaultErrorMessage);
  return toServiceResult(result);
}

// ============================================================================
// Public API
// ============================================================================

import type { BrowsingLogEntry } from '../utils/sqlite-types.js';
import { errorMessage } from '../utils/errorUtils.js';
export type { BrowsingLogEntry };

export interface DateCount {
  date: string; // YYYY-MM-DD
  count: number;
}

/**
 * Query browsing logs with date range and filters.
 * Retries once on first failure to handle SQLite initialization timing.
 *
 * Not a callDashboard() wrapper (PBI-39): the retry loop doesn't fit the
 * generic single-attempt shape.
 */
async function withRetry<K extends DashboardSqliteRequest['subtype']>(
  fn: () => Promise<DashboardSqliteResponseFor<K>>,
  onSuccess: (res: Extract<DashboardSqliteResponseFor<K>, { success: true }>) => ServiceResult<{ rows: BrowsingLogEntry[]; total: number }>,
  onError: (msg: string) => void,
): Promise<ServiceResult<{ rows: BrowsingLogEntry[]; total: number }>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: DashboardSqliteResponseFor<K>;
    try {
      response = await fn();
    } catch (error) {
      if (attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      const classified = categorizeError(errorMessage(error)).message;
      onError(classified);
      return { error: classified };
    }
    if (response.success) {
      try {
        return onSuccess(response as Extract<DashboardSqliteResponseFor<K>, { success: true }>);
      } catch (error) {
        const raw = errorMessage(error);
        console.warn('decode failed:', raw);
        return { error: raw };
      }
    }
    if (attempt === 0 && response.retriable) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      continue;
    }
    const msg = String(response.error || 'Query failed');
    console.warn('failed:', msg);
    return { error: msg };
  }
  return { error: 'Query failed' };
}

/**
 * Fetches browsing log filtered records.
 *
 * Not a callDashboard() wrapper (PBI-39): the retry loop doesn't fit the
 * generic single-attempt shape. Now uses withRetry helper (PBI-18).
 */
export async function queryLogs(options: {
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
  return withRetry<'query'>(
    () => sendDashboardMessage({ subtype: 'query', ...options }),
    (res) => ({
      data: {
        rows: requiredRows(res.rows, 'rows', isBrowsingLogEntry),
        total: requiredNonNegativeNumber(res.total, 'total'),
      },
    }),
    (msg) => console.error('queryLogs failed:', msg),
  );
}

/**
 * FTS5 full-text search.
 * Retries once on first failure to handle SQLite initialization timing.
 *
 * Not a callDashboard() wrapper (PBI-39): same retry-loop shape as queryLogs.
 */
export async function searchLogs(
  query: string,
  limit = 50,
  offset = 0,
  options: { orderBy?: 'rank' | 'created_at'; orderDir?: 'ASC' | 'DESC' } = {}
): Promise<ServiceResult<{ rows: BrowsingLogEntry[]; total: number }>> {
  return withRetry<'search'>(
    () =>
      sendDashboardMessage({
        subtype: 'search',
        query,
        limit,
        offset,
        ...pickDefined({ orderBy: options.orderBy, orderDir: options.orderDir }),
      }),
    (res) => ({
      data: {
        rows: requiredRows(res.rows, 'rows', isBrowsingLogEntry),
        total: requiredNonNegativeNumber(res.total, 'total'),
      },
    }),
    (msg) => console.error('searchLogs failed:', msg),
  );
}

/**
 * Toggle the star status of a log entry.
 *
 * Returns the reason on failure rather than null: the caller renders it, and
 * a bare null left the UI silent — pressing the star simply did nothing when
 * the database was unavailable (PBI-21).
 */
export function toggleStar(id: number): Promise<ServiceResult<{ is_starred: number }>> {
  return callDashboard(
    { subtype: 'toggle_star', id },
    (response) => ({ is_starred: requiredNonNegativeNumber(response.is_starred, 'is_starred') }),
    'Toggle star failed',
  );
}

/**
 * Soft-delete a log entry.
 *
 * See toggleStar: the failure reason travels to the caller so the UI can
 * show it instead of appearing to ignore the click.
 */
export function deleteLog(id: number): Promise<ServiceResult<void>> {
  return callDashboard({ subtype: 'delete', id }, () => undefined, 'Delete failed');
}

/**
 * Update a log entry's fields.
 */
export function updateLog(id: number, changes: Record<string, unknown>): Promise<ServiceResult<void>> {
  return callDashboard({ subtype: 'update', id, changes }, () => undefined, 'Update failed');
}

/**
 * Force re-run the chrome.storage → SQLite migration.
 * Returns the SQLite record count after migration, or null on failure.
 */
export function migrateLogs(): Promise<ServiceResult<{ count: number; read: number; inserted: number }>> {
  return callDashboard(
    { subtype: 'migrate' },
    (response) => ({
      count: requiredNonNegativeNumber(response.count, 'count'),
      read: requiredNonNegativeNumber(response.read, 'read'),
      inserted: requiredNonNegativeNumber(response.inserted, 'inserted'),
    }),
    'Migration failed',
  );
}

export interface OpfsSpikeStepResult { name: string; ok: boolean; detail: string }
export interface OpfsSpikeReportView {
  strategy: string;
  steps: OpfsSpikeStepResult[];
  passed: boolean;
  durationMs: number;
}

function decodeOpfsSpikeReport(value: unknown): OpfsSpikeReportView {
  if (!isRecord(value)
    || typeof value.strategy !== 'string'
    || !Array.isArray(value.steps)
    || !value.steps.every((step) => isRecord(step)
      && typeof step.name === 'string'
      && typeof step.ok === 'boolean'
      && typeof step.detail === 'string')
    || typeof value.passed !== 'boolean'
    || !isFiniteNumber(value.durationMs)
    || value.durationMs < 0) {
    throw new Error('Invalid SQLite response: report');
  }

  return {
    strategy: value.strategy,
    steps: value.steps.map((step) => ({
      name: step.name,
      ok: step.ok,
      detail: step.detail,
    })),
    passed: value.passed,
    durationMs: value.durationMs,
  };
}

/**
 * Run the OPFS feasibility spike (PBI-10) and return its structured report.
 * Used by the diagnostics panel for manual verification in real Chrome.
 */
export function runOpfsSpike(): Promise<ServiceResult<OpfsSpikeReportView>> {
  return callDashboard(
    { subtype: 'opfs_spike' },
    (response) => {
      if (!response.report) throw new Error('OPFS spike returned no report');
      return decodeOpfsSpikeReport(response.report);
    },
    'OPFS spike failed',
  );
}

export function clearAllLogs(): Promise<ServiceResult<void>> {
  return callDashboard({ subtype: 'clear_all' }, () => undefined, 'Clear all failed');
}

/**
 * Get total record count.
 * Returns a ServiceResult so a failure is distinguishable from a count of 0.
 */
export function getLogCount(): Promise<ServiceResult<number>> {
  return callDashboard(
    { subtype: 'get_count' },
    (response) => requiredNonNegativeNumber(response.count, 'count'),
    'Get count failed',
  );
}

/**
 * Get SQLite status including fallback mode flag.
 * Returns diagnostic info even on failure so the UI can display it.
 *
 * Not a callDashboard() wrapper (PBI-39): this function does not return
 * ServiceResult<T> — it returns a status object unconditionally, with
 * initError set on failure, so the diagnostics UI can render fields even
 * when the query failed. isServiceError() below is the type guard other
 * callers use to distinguish the ServiceResult-shaped functions.
 */
export async function getSqliteStatus(): Promise<{
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
  opfsMigrationV2RecordCount?: number | null;
  idbMigrationV2Done?: boolean;
  opfsLegacyDbPath?: string | null;
  idbLegacyDbName?: string | null;
}> {
  let response: DashboardSqliteResponseFor<'status'>;
  try {
    response = await sendDashboardMessage({ subtype: 'status' });
  } catch (error) {
    const classified = categorizeError(errorMessage(error)).message;
    return {
      initialized: false,
      path: '',
      fallback: false,
      fts5: false,
      initError: classified,
    };
  }

  if (response.success) {
    try {
      return {
        initialized: requiredBoolean(response.initialized, 'initialized'),
        path: requiredString(response.path, 'path'),
        fallback: requiredBoolean(response.fallback, 'fallback'),
        fts5: requiredBoolean(response.fts5, 'fts5'),
        ...pickDefined({
          initError: response.initError ? String(response.initError) : undefined,
          ...decodeStatusExtras(response as unknown as Record<string, unknown>),
        }),
      };
    } catch (error) {
      return {
        initialized: false,
        path: '',
        fallback: false,
        fts5: false,
        initError: errorMessage(error),
      };
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


/**
 * Explicitly clean up legacy chrome.storage keys.
 * This is a destructive operation - only call after user confirmation.
 */
export function cleanupLegacyStorage(): Promise<ServiceResult<{ removed: string[]; totalBytes: number }>> {
  return callDashboard(
    { subtype: 'cleanup_legacy' },
    (response) => ({
      removed: Array.isArray(response.removed) ? response.removed : [],
      totalBytes: requiredNonNegativeNumber(response.totalBytes, 'totalBytes'),
    }),
    'Cleanup failed',
  );
}

/**
 * Backfill diagnostic metadata for already-migrated SQLite entries
 * that are missing metric fields (sent_tokens, page_bytes, etc.).
 */
export function backfillMetadata(): Promise<ServiceResult<{ updated: number; total: number }>> {
  return callDashboard(
    { subtype: 'backfill_metadata' },
    (response) => ({
      updated: requiredNonNegativeNumber(response.updated, 'updated'),
      total: requiredNonNegativeNumber(response.total, 'total'),
    }),
    'Backfill failed',
  );
}

/**
 * バイナリ .db バックアップを取得
 */
export function backupDb(): Promise<ServiceResult<Uint8Array>> {
  return callDashboard(
    { subtype: 'backup_db' },
    (response) => {
      if (!response.data) throw new Error('Backup returned no data');
      return base64ToBytes(requiredString(response.data, 'data'));
    },
    'Backup failed',
  );
}

/**
 * Restore the entire history database from a binary snapshot.
 * Requires a confirmation token (destructive operation).
 */
export function restoreDb(data: Uint8Array): Promise<ServiceResult<void>> {
  return callDashboard({ subtype: 'restore_db', data: bytesToBase64(data) }, () => undefined, 'Restore failed');
}

/**
 * Import browsing log rows into SQLite.
 */
export function importLogs(rows: Array<{
  url: string; title?: string; summary?: string; tags?: string;
  created_at: number; domain?: string; visit_duration?: number;
  scroll_ratio?: number; is_starred?: number; is_deleted?: number;
}>): Promise<ServiceResult<{ inserted: number; skipped: number; total: number }>> {
  return callDashboard(
    { subtype: 'import', rows },
    (response) => ({
      inserted: requiredNonNegativeNumber(response.inserted, 'inserted'),
      skipped: requiredNonNegativeNumber(response.skipped, 'skipped'),
      total: requiredNonNegativeNumber(response.total, 'total'),
    }),
    'Import failed',
  );
}

/**
 * Run a manual retention purge of old browsing-log records.
 * Destructive — the confirmToken is attached by the sender's fail-safe default.
 */
export function purgeOldRecordsNow(): Promise<ServiceResult<{ purged: number; skipped: boolean }>> {
  return callDashboard(
    { subtype: 'purge_now' },
    (response) => ({ purged: requiredNonNegativeNumber(response.purged, 'purged'), skipped: requiredBoolean(response.skipped, 'skipped') }),
    'Purge failed',
  );
}

/**
 * Run a manual content purge of stored page content.
 * Destructive — the confirmToken is attached by the sender's fail-safe default.
 */
export function purgeContentNow(): Promise<ServiceResult<{ purged: number; skipped: boolean }>> {
  return callDashboard(
    { subtype: 'content_purge_now' },
    (response) => ({ purged: requiredNonNegativeNumber(response.purged, 'purged'), skipped: requiredBoolean(response.skipped, 'skipped') }),
    'Content purge failed',
  );
}

/**
 * Append selected log entries to Obsidian daily note.
 * Writes to Obsidian — the confirmToken is attached by the sender's fail-safe default.
 */
export function appendToLogs(ids: number[]): Promise<ServiceResult<{ appended: number }>> {
  return callDashboard(
    { subtype: 'append_to_obsidian', ids },
    (response) => ({ appended: requiredNonNegativeNumber(response.appended, 'appended') }),
    'Append failed',
  );
}

/**
 * Query audit log entries (cloud AI provider send events).
 * Read-only on SQLite — no confirm token needed.
 */
export function queryAuditLogs(
  options: { limit?: number; offset?: number } = {}
): Promise<ServiceResult<{ rows: Array<{ id: number; provider: string; url: string; created_at: number }>; total: number }>> {
  return callDashboard(
    { subtype: 'audit_log_query', ...options },
    (response) => ({
      rows: requiredRows(response.rows, 'rows', isAuditLogEntry),
      total: requiredNonNegativeNumber(response.total, 'total'),
    }),
    'Audit log query failed',
  );
}
