/**
 * dashboardSqliteService.ts
 * Provides SQLite-backed data access for the dashboard via SW message passing.
 * The service worker's DASHBOARD_SQLITE handler proxies requests to SqliteClient.
 */

import type { DashboardSqliteRequest } from '../background/handlers/dashboardSqliteProtocol.js';
import type { ArchivePreviewData, ArchiveCreateData, ArchiveExportData, ArchiveRestorePreviewData, ArchiveRestoreData, ArchivePurgeData, ArchiveSessionRow, ArchiveSessionStatusData } from '../messaging/sqliteMessages.js';
import { archiveWireFor, isArchiveOpType, type ArchiveDescriptor, type DescriptorPublic } from '../messaging/archiveWireTable.js';
import {
  sqliteWireFor,
  dashboardServiceWireFor,
  type SqliteWireDescriptor,
  type SqliteDashboardHop,
  type DescriptorService,
  type DashboardRetryPolicy,
  type DashboardServiceDescriptor,
  type DashboardServiceResult,
} from '../messaging/sqliteWireTable.js';
// PBI-05: unified SqliteResult vocabulary — both hops now share the same
// error classification and result shape via SqliteGateway.
// PBI 11: the DASHBOARD_SQLITE send policy (token gate, timeout, retry) lives
// in src/messaging/dashboardGateway.ts; this service owns only conversion.
import { dashboardGateway, type SqliteResult } from '../messaging/dashboardGateway.js';
import { bytesToBase64, base64ToBytes } from '../utils/crypto/index.js';
import { errorMessage } from '../utils/errorUtils.js';
import { pickDefined } from '../utils/objectUtils.js';
import type { SqliteStatusResult } from '../messaging/sqliteMessages.js';

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
 * Unified table-driven runner (PBI 2026-09-23-02).
 *
 * The previous `callDashboard` / `callSqliteWire` / `callArchive` triple is
 * dissolved into one path: every op resolves to a row (query/mutate wire
 * row, archive row, or dashboard-service row) that owns the decode, the
 * fallback message, and the retry policy. Callers pass op + payload only —
 * retry/noRetry semantics live in the rows, never in caller flags.
 *
 * Layer note: the precise per-op payload/result types below are dashboard-
 * tier derivations over the loose row codecs in messaging/ (which must stay
 * free of background/dashboard imports). The runtime resolution needs no
 * precise types — only subtype, decode, defaultError, retry.
 */

// Dashboard-capable wire rows (the 7 with a dashboard hop; insert/insertBatch/
// insertAuditLog have no dashboard subtype and are unreachable here).
type WireDashboardDescriptor = Extract<SqliteWireDescriptor, { dashboard: SqliteDashboardHop<unknown> }>;

type WireClientMap = {
  [D in WireDashboardDescriptor as D['op']]: {
    payload: Extract<DashboardSqliteRequest, { subtype: NonNullable<D['dashboard']>['subtype'] }>;
    result: DescriptorService<D>;
  };
};

type ArchiveClientMap = {
  [D in ArchiveDescriptor as D['op']]: {
    payload: Extract<DashboardSqliteRequest, { subtype: D['subtype'] }>;
    result: DescriptorPublic<D>;
  };
};

type ServiceClientMap = {
  [D in DashboardServiceDescriptor as D['op']]: {
    payload: Extract<DashboardSqliteRequest, { subtype: D['subtype'] }>;
    result: DashboardServiceResult<D>;
  };
};

export interface SqliteClientMap extends WireClientMap, ArchiveClientMap, ServiceClientMap {}
export type SqliteClientOp = keyof SqliteClientMap;
export type SqliteClientPayload<O extends SqliteClientOp> = SqliteClientMap[O]['payload'];
export type SqliteClientResult<O extends SqliteClientOp> = SqliteClientMap[O]['result'];

// Compile-time coverage: every DASHBOARD_SQLITE subtype except the token
// handshake must be reachable through the generic call — a new subtype
// without a row is a type error here, not a runtime drift.
type CoveredSubtype = SqliteClientMap[SqliteClientOp]['payload']['subtype'];
type MissingClientSubtype = Exclude<DashboardSqliteRequest['subtype'], CoveredSubtype | 'create_confirm_token'>;
const _clientCoversSubtypes: MissingClientSubtype extends never ? true : never = true;
void _clientCoversSubtypes;

/** Loose runtime view over the three row kinds (all carry the same triple). */
interface ClientRow {
  defaultError: string;
  retry?: DashboardRetryPolicy;
  serviceDecode: (response: { success: true } & Record<string, unknown>) => unknown;
}

function resolveClientRow(op: string): ClientRow | undefined {
  const wireDashboard = sqliteWireFor(op)?.dashboard;
  if (wireDashboard) return wireDashboard;
  if (isArchiveOpType(op)) {
    const entry = archiveWireFor(op);
    // Row owns the decode (offscreenGateway references the same row — the
    // former ARCHIVE_GATEWAY_DECODERS copy is gone). Archive ops never
    // retry from the dashboard: no retry field, single attempt.
    if (entry) return { defaultError: entry.defaultError, serviceDecode: (response) => entry.decodeResponse(response) };
    return undefined;
  }
  return dashboardServiceWireFor(op) ?? undefined;
}

/**
 * The single deep entry point: `sqliteClient.call(op, payload)`.
 * Fail-closed on unknown ops (throws — never a silent default).
 */
export const sqliteClient = {
  call<O extends SqliteClientOp>(op: O, payload: SqliteClientPayload<O>): Promise<ServiceResult<SqliteClientResult<O>>> {
    const row = resolveClientRow(op);
    if (!row) throw new Error(`Unhandled dashboard SQLite op: ${op}`);
    return callClientRow<SqliteClientResult<O>>(row, payload);
  },
};

async function callClientRow<R>(
  row: ClientRow,
  payload: DashboardSqliteRequest,
): Promise<ServiceResult<R>> {
  const result = await dashboardGateway.callDashboard(
    payload,
    (response) => row.serviceDecode(response) as R,
    row.defaultError,
    row.retry,
  );
  return toServiceResult(result);
}

// ============================================================================
// Public API
// ============================================================================

import type { BrowsingLogEntry } from '../utils/sqlite-types.js';
export type { BrowsingLogEntry };

export interface DateCount {
  date: string; // YYYY-MM-DD
  count: number;
}

/**
 * Query browsing logs with date range and filters.
 * Retry lives in the records row (SQLite init timing); this stays a delegate.
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
  return sqliteClient.call('records', { subtype: 'query', ...options });
}

/**
 * FTS5 full-text search.
 * Retry lives in the search row (same init-timing shape as queryLogs).
 */
export async function searchLogs(
  query: string,
  limit = 50,
  offset = 0,
  options: { orderBy?: 'rank' | 'created_at'; orderDir?: 'ASC' | 'DESC' } = {}
): Promise<ServiceResult<{ rows: BrowsingLogEntry[]; total: number }>> {
  return sqliteClient.call('search', {
    subtype: 'search',
    query,
    limit,
    offset,
    ...pickDefined({ orderBy: options.orderBy, orderDir: options.orderDir }),
  });
}

/**
 * Toggle the star status of a log entry.
 *
 * Returns the reason on failure rather than null: the caller renders it, and
 * a bare null left the UI silent — pressing the star simply did nothing when
 * the database was unavailable (PBI-21).
 */
export function toggleStar(id: number): Promise<ServiceResult<{ is_starred: number }>> {
  return sqliteClient.call('toggleStar', { subtype: 'toggle_star', id });
}

/**
 * Soft-delete a log entry.
 *
 * See toggleStar: the failure reason travels to the caller so the UI can
 * show it instead of appearing to ignore the click.
 */
export function deleteLog(id: number): Promise<ServiceResult<void>> {
  return sqliteClient.call('delete', { subtype: 'delete', id });
}

/**
 * Update a log entry's fields.
 */
export function updateLog(id: number, changes: Record<string, unknown>): Promise<ServiceResult<void>> {
  return sqliteClient.call('update', { subtype: 'update', id, changes });
}

/**
 * Force re-run the chrome.storage → SQLite migration.
 * Returns the SQLite record count after migration, or null on failure.
 */
export function migrateLogs(): Promise<ServiceResult<{ count: number; read: number; inserted: number }>> {
  return sqliteClient.call('migrate', { subtype: 'migrate' });
}

export function clearAllLogs(): Promise<ServiceResult<void>> {
  return sqliteClient.call('clearAll', { subtype: 'clear_all' });
}

/**
 * Get total record count.
 * Returns a ServiceResult so a failure is distinguishable from a count of 0.
 */
export function getLogCount(): Promise<ServiceResult<number>> {
  return sqliteClient.call('count', { subtype: 'get_count' });
}

/**
 * Get SQLite status including fallback mode flag.
 * Returns diagnostic info even on failure so the UI can display it.
 *
 * Transport goes through DashboardGateway.callDashboard (PBI 11); only the
 * SqliteResult → status-shape conversion lives here because this function
 * does not return ServiceResult<T> — it returns a status object
 * unconditionally, with initError set on failure.
 */
export async function getSqliteStatus(): Promise<SqliteStatusResult> {
  // The row owns the success decode; only the degraded-status fallback lives
  // here because this function never returns ServiceResult — it returns a
  // status object unconditionally, with initError set on failure.
  const result = await sqliteClient.call('status', { subtype: 'status' });
  if ('error' in result) {
    return {
      initialized: false,
      path: '',
      fallback: false,
      fts5: false,
      initError: result.error,
    };
  }
  return result.data;
}


/**
 * Explicitly clean up legacy chrome.storage keys.
 * This is a destructive operation - only call after user confirmation.
 */
export function cleanupLegacyStorage(): Promise<ServiceResult<{ removed: string[]; totalBytes: number }>> {
  return sqliteClient.call('cleanupLegacy', { subtype: 'cleanup_legacy' });
}

/**
 * Backfill diagnostic metadata for already-migrated SQLite entries
 * that are missing metric fields (sent_tokens, page_bytes, etc.).
 */
export function backfillMetadata(): Promise<ServiceResult<{ updated: number; total: number }>> {
  return sqliteClient.call('backfill', { subtype: 'backfill_metadata' });
}

/**
 * Manually resync recent SQLite records into the legacy chrome.storage
 * store (PBI 22, MANUAL-ONLY trigger — diagnostics panel button only).
 * Merges by URL (idempotent); bounded by maxRecords (server-side default
 * and cap apply when omitted or invalid).
 */
export function resyncLegacyStorage(maxRecords?: number): Promise<ServiceResult<{ examined: number; written: number; skipped: number; total: number }>> {
  return sqliteClient.call('resync', { subtype: 'resync_legacy', ...(maxRecords === undefined ? {} : { maxRecords }) });
}

/**
 * バイナリ .db バックアップを取得
 *
 * The row decodes to the base64 string; bytes conversion stays in this alias
 * (the bytes/base64 codec is utils/crypto territory, not the wire table's).
 * A conversion failure surfaces as an error result, matching the old
 * decode-throw path that the gateway classified the same way.
 */
export async function backupDb(): Promise<ServiceResult<Uint8Array>> {
  const result = await sqliteClient.call('backupDb', { subtype: 'backup_db' });
  if ('error' in result) return result;
  try {
    return { data: base64ToBytes(result.data) };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

/**
 * Restore the entire history database from a binary snapshot.
 * Requires a confirmation token (destructive operation).
 */
export function restoreDb(data: Uint8Array): Promise<ServiceResult<void>> {
  return sqliteClient.call('restoreDb', { subtype: 'restore_db', data: bytesToBase64(data) });
}

// ============================================================================
// Archive (PBI 2026-09-06-02)
//
// PBI 2026-09-07-22: the 14 public functions below keep their names and
// signatures (callers such as archivePanel break otherwise); only the
// internals share a seam.
// PBI 2026-09-09-05: the seam is now the wire-table descriptor — sqliteClient
// resolves the row, which owns the decode and the fallback message, so the
// per-op shape knowledge lives in exactly one place.
// PBI 2026-09-23-02: callArchive dissolved into sqliteClient.call.
// ============================================================================

/**
 * Preview how many records archive_create would collect for the boundary.
 * Read-only (token-exempt).
 */
export function archivePreview(cutoffDate: string, cutoffMs: number, includeDeleted: boolean): Promise<ServiceResult<ArchivePreviewData>> {
  return sqliteClient.call('archivePreview', { subtype: 'archive_preview', cutoffDate, cutoffMs, includeDeleted });
}

/**
 * Create the archive staging file (phase A). The main DB is NOT modified —
 * deletion happens in PBI 2026-09-06-04. Returns the staging name so the
 * file can be downloaded (chunked export) and later deleted (phase B).
 */
export function archiveCreate(params: {
  cutoffDate: string;
  cutoffMs: number;
  includeDeleted: boolean;
  yasumaroVersion: string;
}): Promise<ServiceResult<ArchiveCreateData>> {
  return sqliteClient.call('archiveCreate', { subtype: 'archive_create', ...params });
}

/** Sweep orphan staging files. */
export function archiveCleanup(): Promise<ServiceResult<{ removed: string[] }>> {
  return sqliteClient.call('archiveCleanup', { subtype: 'archive_cleanup' });
}

/** Read one chunk of a staging file (loop until `done`, then assemble). */
export function archiveExportChunk(stagingName: string, offset: number, length: number): Promise<ServiceResult<ArchiveExportData>> {
  return sqliteClient.call('archiveExport', { subtype: 'archive_export', stagingName, offset, length });
}

/**
 * Issue a registered incoming staging name (offscreen-generated). The
 * dashboard then writes the picked file's bytes into that OPFS file.
 */
export function archivePrepareIncoming(): Promise<ServiceResult<string>> {
  return sqliteClient.call('archivePrepareIncoming', { subtype: 'archive_prepare_incoming' });
}

/** Read-only preview of a validated staging archive (confirm-dialog data). */
export function archiveRestorePreview(stagingName: string): Promise<ServiceResult<ArchiveRestorePreviewData>> {
  return sqliteClient.call('archiveRestorePreview', { subtype: 'archive_restore_preview', stagingName });
}

/**
 * Phase B (PBI 2026-09-06-04): delete the main-DB rows covered by the
 * verified staging archive, then VACUUM. Destructive — token + scopeHash
 * bound to the staging name.
 */
export function archiveDeleteByStaging(stagingName: string): Promise<ServiceResult<ArchivePurgeData>> {
  return sqliteClient.call('archiveDeleteByStaging', { subtype: 'archive_delete_by_staging', stagingName });
}

/** Merge-restore the staging archive into the main DB (destructive-op gate). */
export function archiveRestore(stagingName: string): Promise<ServiceResult<ArchiveRestoreData>> {
  return sqliteClient.call('archiveRestore', { subtype: 'archive_restore', stagingName });
}

/** Open a staged archive as a temp session (PBI 2026-09-06-05). */
export function archiveOpen(stagingName: string): Promise<ServiceResult<void>> {
  return sqliteClient.call('archiveOpen', { subtype: 'archive_open', stagingName });
}

/** Query the open archive session (LIKE search on url/title/summary). */
export function archiveQuery(stagingName: string, query: string, limit: number, offset: number): Promise<ServiceResult<{ rows: ArchiveSessionRow[]; total: number }>> {
  return sqliteClient.call('archiveQuery', { subtype: 'archive_query', stagingName, query, limit, offset });
}

/** Update a whitelisted field of an archive row (marks session dirty). */
export function archiveUpdate(stagingName: string, id: number, changes: Record<string, unknown>): Promise<ServiceResult<{ dirty: boolean }>> {
  return sqliteClient.call('archiveUpdate', { subtype: 'archive_update', stagingName, id, changes });
}

/** Flush the session WAL into the staging file (save checkpoint). */
export function archiveSave(stagingName: string): Promise<ServiceResult<{ dirty: boolean }>> {
  return sqliteClient.call('archiveSave', { subtype: 'archive_save', stagingName });
}

/** Close the temp session (rejects when dirty — two-defense with the UI). */
export function archiveClose(stagingName: string): Promise<ServiceResult<{ dirty: boolean }>> {
  return sqliteClient.call('archiveClose', { subtype: 'archive_close', stagingName });
}

/** Reconnect/status probe for the temp session. */
export function archiveStatus(): Promise<ServiceResult<ArchiveSessionStatusData>> {
  return sqliteClient.call('archiveStatus', { subtype: 'archive_status' });
}

/**
 * Import browsing log rows into SQLite.
 */
export function importLogs(rows: Array<{
  url: string; title?: string; summary?: string; tags?: string;
  created_at: number; domain?: string; visit_duration?: number;
  scroll_ratio?: number; is_starred?: number; is_deleted?: number;
}>): Promise<ServiceResult<{ inserted: number; skipped: number; total: number }>> {
  return sqliteClient.call('import', { subtype: 'import', rows });
}

/**
 * Run a manual retention purge of old browsing-log records.
 * Destructive — the confirmToken is attached by the sender's fail-safe default.
 */
export function purgeOldRecordsNow(): Promise<ServiceResult<{ purged: number; skipped: boolean }>> {
  return sqliteClient.call('purgeNow', { subtype: 'purge_now' });
}

/**
 * Run a manual content purge of stored page content.
 * Destructive — the confirmToken is attached by the sender's fail-safe default.
 */
export function purgeContentNow(): Promise<ServiceResult<{ purged: number; skipped: boolean }>> {
  return sqliteClient.call('contentPurgeNow', { subtype: 'content_purge_now' });
}

/**
 * Append selected log entries to Obsidian daily note.
 * Writes to Obsidian — the confirmToken is attached by the sender's fail-safe default.
 */
export function appendToLogs(ids: number[]): Promise<ServiceResult<{ appended: number }>> {
  return sqliteClient.call('appendToLogs', { subtype: 'append_to_obsidian', ids });
}

/**
 * Query audit log entries (cloud AI provider send events).
 * Read-only on SQLite — no confirm token needed.
 */
export function queryAuditLogs(
  options: { limit?: number; offset?: number } = {}
): Promise<ServiceResult<{ rows: Array<{ id: number; provider: string; url: string; created_at: number }>; total: number }>> {
  return sqliteClient.call('auditLog', { subtype: 'audit_log_query', ...options });
}
