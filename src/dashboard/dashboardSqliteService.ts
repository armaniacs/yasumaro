/**
 * dashboardSqliteService.ts
 * Provides SQLite-backed data access for the dashboard via SW message passing.
 * The service worker's DASHBOARD_SQLITE handler proxies requests to SqliteClient.
 */

import type { DashboardSqliteRequest, DashboardSqliteResponseFor } from '../background/handlers/dashboardSqliteProtocol.js';
import { CURRENT_PROTOCOL_VERSION } from '../background/messageTypes.js';
import { tokenExempt } from '../messaging/sqliteOperationSecurity.js';
import { bytesToBase64, base64ToBytes } from '../utils/crypto/index.js';
import { pickDefined } from '../utils/objectUtils.js';

const DASHBOARD_SQLITE_TIMEOUT = 10000;
const CONFIRM_TOKEN_KEY = 'dashboardSqliteConfirmToken';

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
 */
export type ServiceResult<T> = { data: T } | { error: string };

/** Narrowing helper so call sites do not each re-derive the check. */
export function isServiceError<T>(result: ServiceResult<T>): result is { error: string } {
  return 'error' in result;
}

function requiredFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid SQLite response: ${field}`);
  }
  return value;
}

function requiredNonNegativeNumber(value: unknown, field: string): number {
  const number = requiredFiniteNumber(value, field);
  if (number < 0) {
    throw new Error(`Invalid SQLite response: ${field}`);
  }
  return number;
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid SQLite response: ${field}`);
  }
  return value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid SQLite response: ${field}`);
  }
  return value;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  return requiredBoolean(value, field);
}

function optionalNullableString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  return requiredString(value, field);
}

function optionalNonNegativeNumber(value: unknown, field: string): number {
  if (value === undefined || value === null) return 0;
  return requiredNonNegativeNumber(value, field);
}

/**
 * Send a DASHBOARD_SQLITE message to the service worker.
 */
async function getConfirmToken(): Promise<string | null> {
  try {
    const stored = await chrome.storage.session.get(CONFIRM_TOKEN_KEY) as Record<string, string | undefined>;
    if (stored[CONFIRM_TOKEN_KEY]) {
      return stored[CONFIRM_TOKEN_KEY];
    }
  } catch (error) {
    console.error('Failed to read dashboard SQLite confirmToken:', error);
  }

  try {
    const response = await sendDashboardMessage({ subtype: 'confirm_token' });
    if (response.success && typeof response.confirmToken === 'string') {
      await chrome.storage.session.set({ [CONFIRM_TOKEN_KEY]: response.confirmToken });
      return response.confirmToken;
    }
  } catch (error) {
    console.error('Failed to request dashboard SQLite confirmToken:', error);
  }

  return null;
}

async function withConfirmToken<T extends DashboardSqliteRequest>(payload: T): Promise<T & { confirmToken?: string }> {
  const confirmToken = await getConfirmToken();
  return confirmToken ? { ...payload, confirmToken } : payload;
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

  // Use Promise-based API (MV3) with timeout for reliability.
  // The callback-based API can silently fail with chrome.runtime.lastError
  // when the service worker responds async via sendResponse().
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
 * @param payload - The request payload (subtype + fields).
 * @param decode - Called with the successful response to build the success
 *   data. Throwing here (e.g. via the requiredXxx/requiredRows helpers) is
 *   caught and reported as a decode failure, same as a network exception.
 * @param defaultErrorMessage - Used when the response carries no `error` field.
 */
async function callDashboard<T extends DashboardSqliteRequest, R>(
  payload: T,
  decode: (response: Extract<DashboardSqliteResponseFor<T['subtype']>, { success: true }>) => R,
  defaultErrorMessage: string,
): Promise<ServiceResult<R>> {
  try {
    const response = await sendDashboardMessage(payload);
    if (response.success) {
      return { data: decode(response) };
    }
    console.warn(`${payload.subtype} failed:`, String(response.error || 'Unknown error'));
    return { error: String(response.error || defaultErrorMessage) };
  } catch (error) {
    console.error(`${payload.subtype} failed:`, errorMessage(error));
    return { error: errorMessage(error) };
  }
}

// ============================================================================
// Public API
// ============================================================================

import type { BrowsingLogEntry } from '../utils/sqlite-types.js';
import { errorMessage } from '../utils/errorUtils.js';
export type { BrowsingLogEntry };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function requiredRows<T>(
  value: unknown,
  field: string,
  isRow: (value: unknown) => value is T,
): T[] {
  if (!Array.isArray(value) || !value.every(isRow)) {
    throw new Error(`Invalid SQLite response: ${field}`);
  }
  return value;
}

function isBrowsingLogEntry(value: unknown): value is BrowsingLogEntry {
  return isRecord(value)
    && isFiniteNumber(value.id)
    && typeof value.url === 'string'
    && isFiniteNumber(value.created_at);
}

type AuditLogEntryView = { id: number; provider: string; url: string; created_at: number };

function isAuditLogEntry(value: unknown): value is AuditLogEntryView {
  return isRecord(value)
    && isFiniteNumber(value.id)
    && typeof value.provider === 'string'
    && typeof value.url === 'string'
    && isFiniteNumber(value.created_at);
}

function requiredStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    throw new Error(`Invalid SQLite response: ${field}`);
  }
  return value;
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  return requiredStringArray(value, field);
}

type CompileOptionsSource = 'opfs-worker' | 'idb' | 'fallback';

function optionalCompileOptionsSource(value: unknown): CompileOptionsSource | undefined {
  if (value === undefined) return undefined;
  if (value === 'opfs-worker' || value === 'idb' || value === 'fallback') return value;
  throw new Error('Invalid SQLite response: compileOptionsSource');
}

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
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await sendDashboardMessage({ subtype: 'query', ...options });
      if (response.success) {
        return {
          data: {
            rows: requiredRows(response.rows, 'rows', isBrowsingLogEntry),
            total: requiredNonNegativeNumber(response.total, 'total'),
          },
        };
      }
      // Retry only when the service worker says the failure is transient.
      // This used to match the message text for 'Query failed', which is the
      // fallback wording used when no specific error was available — so the
      // retry stopped firing as soon as errors became specific.
      if (attempt === 0 && response.retriable) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      console.warn('queryLogs failed:', String(response.error || 'Unknown error'));
      return { error: String(response.error || 'Query failed') };
    } catch (error) {
      if (attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      console.error('queryLogs failed:', errorMessage(error));
      return { error: errorMessage(error) };
    }
  }
  return { error: 'Query failed' };
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
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await sendDashboardMessage({
        subtype: 'search',
        query,
        limit,
        offset,
        ...pickDefined({ orderBy: options.orderBy, orderDir: options.orderDir }),
      });
      if (response.success) {
        return {
          data: {
            rows: requiredRows(response.rows, 'rows', isBrowsingLogEntry),
            total: requiredNonNegativeNumber(response.total, 'total'),
          },
        };
      }
      // See queryLogs: retriability now comes from the service worker's
      // error classification rather than the wording of the message.
      if (attempt === 0 && response.retriable) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      console.warn('searchLogs failed:', String(response.error || 'Unknown error'));
      return { error: String(response.error || 'Search failed') };
    } catch (error) {
      if (attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      console.error('searchLogs failed:', errorMessage(error));
      return { error: errorMessage(error) };
    }
  }
  return { error: 'Search failed' };
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
 *
 * Not a callDashboard() wrapper (PBI-39): success also requires a non-empty
 * `report` field, which callDashboard's single success/failure branch
 * doesn't model.
 */
export async function runOpfsSpike(): Promise<ServiceResult<OpfsSpikeReportView>> {
  try {
    const response = await sendDashboardMessage({ subtype: 'opfs_spike' });
    if (response.success && response.report) {
      return { data: decodeOpfsSpikeReport(response.report) };
    }
    return { error: response.success ? 'OPFS spike returned no report' : String(response.error || 'OPFS spike failed') };
  } catch (error) {
    console.error('runOpfsSpike failed:', errorMessage(error));
    return { error: errorMessage(error) };
  }
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
  opfsMigrationV2RecordCount?: number;
}> {
  try {
    const response = await sendDashboardMessage({ subtype: 'status' });
    if (response.success) {
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
    }
    return {
      initialized: false,
      path: '',
      fallback: false,
      fts5: false,
      initError: String(response.error || 'Failed to get SQLite status'),
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
 *
 * Not a callDashboard() wrapper (PBI-39): success also requires a non-empty
 * `data` field (an empty backup must not look like success), and the
 * decoded value needs a distinct error message from a transport failure.
 */
export async function backupDb(): Promise<ServiceResult<Uint8Array>> {
  try {
    const response = await sendDashboardMessage(
      { subtype: 'backup_db' },
    );
    if (response.success && response.data) {
      return { data: base64ToBytes(requiredString(response.data, 'data')) };
    }
    // A failed backup must not look like "nothing to back up" — the caller
    // would otherwise offer the user an empty or missing file as success.
    const message = response.success
      ? 'Backup returned no data'
      : String(response.error || 'Backup failed');
    console.warn('backupDb failed:', message);
    return { error: message };
  } catch (error) {
    console.error('backupDb failed:', errorMessage(error));
    return { error: errorMessage(error) };
  }
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
