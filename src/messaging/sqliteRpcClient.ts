/**
 * Shared SQLite RPC types and interface.
 *
 * PBI-05: both the Service Worker's SqliteClient and the Dashboard's
 * DASHBOARD_SQLITE proxy need the same error classification and a common
 * result vocabulary. Keeping them in one neutral module prevents the two
 * sides from drifting and lets either side explain a failure consistently.
 */
import type { BrowsingLogRecord, StorageQuery } from '../utils/sqlite-types.js';
import type { OpfsSpikeReport } from '../offscreen/opfsSpike.js';
import type { ArchivePreviewData, ArchiveCreateData, ArchiveExportData, ArchiveRestorePreviewData, ArchiveRestoreData, ArchivePurgeData, ArchiveSessionRow, ArchiveSessionStatusData } from './sqliteMessages.js';
export type { ArchivePreviewData, ArchiveCreateData, ArchiveExportData, ArchiveRestorePreviewData, ArchiveRestoreData, ArchivePurgeData, ArchiveSessionRow, ArchiveSessionStatusData };

/**
 * What kind of failure this was.
 *
 * The raw input is still a string — Chrome extension APIs report errors as
 * messages, not typed exceptions (ADR 2026-07-13, assumption G). What changed
 * is that the classification survives: it used to be folded straight into an
 * English sentence and discarded, so callers wanting to know "is this worth
 * retrying?" had to pattern-match the prose back out again.
 */
export type SqliteErrorKind =
  | 'timeout'         // request timed out; the DB may still be initializing
  | 'offscreen_lost'  // offscreen document went away
  | 'quota'           // storage quota exceeded
  | 'sqlite_error'    // SQLite itself reported a problem
  | 'unknown';

export interface SqliteError {
  kind: SqliteErrorKind;
  /** User-facing message. Unchanged from the pre-classification wording. */
  message: string;
  /**
   * Whether retrying the same call could plausibly succeed.
   *
   * Only timeouts qualify: the offscreen document plus WASM load can outrun
   * the first query after the dashboard opens. Quota and SQLite errors are
   * deterministic, and a lost offscreen document needs a reload, so retrying
   * those just delays the error the user needs to see.
   */
  retriable: boolean;
}

export function categorizeError(msg: string): SqliteError {
  if (msg.includes('timed out') || msg.includes('Timeout')) {
    return {
      kind: 'timeout',
      message: 'SQLite request timed out. The database may still be initializing.',
      retriable: true,
    };
  }
  if (msg.includes('offscreen') || msg.includes('offscreenDocument')) {
    return {
      kind: 'offscreen_lost',
      message: 'Database connection lost. Please reload the extension.',
      retriable: false,
    };
  }
  if (msg.includes('quota') || msg.includes('QuotaExceededError')) {
    return {
      kind: 'quota',
      message: 'Storage quota exceeded. Some older records may have been removed.',
      retriable: false,
    };
  }
  if (msg.includes('SQLITE_') || msg.includes('disk I/O')) {
    return { kind: 'sqlite_error', message: `Database error: ${msg}`, retriable: false };
  }
  return { kind: 'unknown', message: `Unexpected error: ${msg}`, retriable: false };
}

/**
 * The canonical RPC result shape: success carries data, failure carries a
 * classified SqliteError. Used by SqliteClient and understood by the
 * dashboard-side proxy so both sides classify failures the same way.
 */
export type SqliteRpcResult<T> =
  | { success: true; data: T }
  | { success: false; error: SqliteError };

/**
 * Interface for an SQLite RPC client. SqliteClient in the Service Worker is
 * the production implementation; tests and future dashboard-local clients can
 * implement the same contract.
 *
 * Deep module (PBI 2026-08-21-03): the former 20-method 1:1 mirror of the
 * offscreen message table is grouped into four domain methods. Per-operation
 * payloads and result transforms live behind each domain; overloads keep
 * call-site types precise without exposing the transport message types.
 */

/** Audit log row shape shared by insert/query audit operations. */
export interface AuditLogRecord {
  id: number;
  provider: string;
  url: string;
  created_at: number;
}

export type MutateOp =
  | { type: 'insert'; record: BrowsingLogRecord; traceId?: string }
  | { type: 'insertBatch'; records: BrowsingLogRecord[] }
  | { type: 'update'; id: number; changes: Partial<Record<string, unknown>>; traceId?: string }
  | { type: 'delete'; id: number }
  | { type: 'toggleStar'; id: number }
  | { type: 'insertAuditLog'; record: Omit<AuditLogRecord, 'id'> };

export type QueryOp =
  | { kind: 'records'; q?: StorageQuery }
  | {
      kind: 'search';
      text: string;
      limit?: number;
      offset?: number;
      orderBy?: 'rank' | 'created_at';
      orderDir?: 'ASC' | 'DESC';
    }
  | { kind: 'count' }
  | { kind: 'auditLog'; limit?: number; offset?: number };

export type MaintainOp =
  | { type: 'init' }
  | { type: 'backup' }
  | { type: 'restore'; data: Uint8Array }
  | { type: 'clearAll' }
  | { type: 'purgeOldRecords'; retentionDays?: number; maxRecords?: number }
  | { type: 'purgeContent'; retentionDays?: number; maxRecords?: number; includeStarred?: boolean }
  | { type: 'opfsSpike' }
  | { type: 'healthCheck' }
  | { type: 'archivePreview'; cutoffMs: number; includeDeleted: boolean }
  | { type: 'archiveCreate'; cutoffDate: string; cutoffMs: number; includeDeleted: boolean; yasumaroVersion: string }
  | { type: 'archiveCleanup' }
  | { type: 'archiveExport'; stagingName: string; offset: number; length: number }
  | { type: 'archivePrepareIncoming' }
  | { type: 'archiveRestorePreview'; stagingName: string }
  | { type: 'archiveRestore'; stagingName: string }
  | { type: 'archiveDeleteByStaging'; stagingName: string }
  | { type: 'archiveOpen'; stagingName: string }
  | { type: 'archiveQuery'; stagingName: string; query: string; limit: number; offset: number }
  | { type: 'archiveUpdate'; stagingName: string; id: number; changes: Record<string, unknown> }
  | { type: 'archiveSave'; stagingName: string }
  | { type: 'archiveClose'; stagingName: string }
  | { type: 'archiveStatus' };

export interface SqliteRpcClient {
  /** Filtered listing or FTS5/LIKE search over browsing records. */
  query(q?: StorageQuery): Promise<SqliteRpcResult<{ rows: BrowsingLogRecord[]; total: number }>>;
  query(op: Extract<QueryOp, { kind: 'search' }>): Promise<SqliteRpcResult<{ rows: BrowsingLogRecord[]; total: number }>>;
  query(op: Extract<QueryOp, { kind: 'count' }>): Promise<SqliteRpcResult<number>>;
  query(op: Extract<QueryOp, { kind: 'auditLog' }>): Promise<SqliteRpcResult<{ rows: AuditLogRecord[]; total: number }>>;
  query(op: QueryOp | StorageQuery): Promise<SqliteRpcResult<unknown>>;

  mutate(op: Extract<MutateOp, { type: 'insert' }>): Promise<SqliteRpcResult<{ id: number }>>;
  mutate(op: Extract<MutateOp, { type: 'insertBatch' }>): Promise<SqliteRpcResult<{ count: number }>>;
  mutate(op: Extract<MutateOp, { type: 'update' } | Extract<MutateOp, { type: 'delete' }>>): Promise<SqliteRpcResult<void>>;
  mutate(op: Extract<MutateOp, { type: 'toggleStar' }>): Promise<SqliteRpcResult<{ is_starred: number }>>;
  mutate(op: Extract<MutateOp, { type: 'insertAuditLog' }>): Promise<SqliteRpcResult<{ id: number }>>;
  mutate(op: MutateOp): Promise<SqliteRpcResult<unknown>>;

  maintain(op: Extract<MaintainOp, { type: 'init' }>): Promise<SqliteRpcResult<boolean>>;
  maintain(op: Extract<MaintainOp, { type: 'backup' }>): Promise<SqliteRpcResult<Uint8Array>>;
  maintain(op: Extract<MaintainOp, { type: 'restore' } | Extract<MaintainOp, { type: 'clearAll' }>>): Promise<SqliteRpcResult<void>>;
  maintain(
    op: Extract<MaintainOp, { type: 'purgeOldRecords' }> | Extract<MaintainOp, { type: 'purgeContent' }>,
  ): Promise<SqliteRpcResult<{ purged: number }>>;
  maintain(op: Extract<MaintainOp, { type: 'opfsSpike' }>): Promise<SqliteRpcResult<OpfsSpikeReport>>;
  maintain(op: Extract<MaintainOp, { type: 'healthCheck' }>): Promise<SqliteRpcResult<boolean>>;
  maintain(op: Extract<MaintainOp, { type: 'archivePreview' }>): Promise<SqliteRpcResult<ArchivePreviewData>>;
  maintain(op: Extract<MaintainOp, { type: 'archiveCreate' }>): Promise<SqliteRpcResult<ArchiveCreateData>>;
  maintain(op: Extract<MaintainOp, { type: 'archiveCleanup' }>): Promise<SqliteRpcResult<{ removed: string[] }>>;
  maintain(op: Extract<MaintainOp, { type: 'archiveExport' }>): Promise<SqliteRpcResult<ArchiveExportData>>;
  maintain(op: Extract<MaintainOp, { type: 'archivePrepareIncoming' }>): Promise<SqliteRpcResult<string>>;
  maintain(op: Extract<MaintainOp, { type: 'archiveRestorePreview' }>): Promise<SqliteRpcResult<ArchiveRestorePreviewData>>;
  maintain(op: Extract<MaintainOp, { type: 'archiveRestore' }>): Promise<SqliteRpcResult<ArchiveRestoreData>>;
  maintain(op: Extract<MaintainOp, { type: 'archiveDeleteByStaging' }>): Promise<SqliteRpcResult<ArchivePurgeData>>;
  maintain(op: Extract<MaintainOp, { type: 'archiveOpen' }>): Promise<SqliteRpcResult<void>>;
  maintain(op: Extract<MaintainOp, { type: 'archiveQuery' }>): Promise<SqliteRpcResult<{ rows: ArchiveSessionRow[]; total: number }>>;
  maintain(op: Extract<MaintainOp, { type: 'archiveUpdate' }>): Promise<SqliteRpcResult<{ dirty: boolean }>>;
  maintain(op: Extract<MaintainOp, { type: 'archiveSave' }>): Promise<SqliteRpcResult<{ dirty: boolean }>>;
  maintain(op: Extract<MaintainOp, { type: 'archiveClose' }>): Promise<SqliteRpcResult<{ dirty: boolean }>>;
  maintain(op: Extract<MaintainOp, { type: 'archiveStatus' }>): Promise<SqliteRpcResult<ArchiveSessionStatusData>>;
  maintain(op: MaintainOp): Promise<SqliteRpcResult<unknown>>;

  /**
   * Diagnostics snapshot. On failure returns degraded diagnostic info so the
   * UI can display what went wrong instead of a bare error.
   */
  getStatus(): Promise<Omit<import('../messaging/sqliteMessages.js').OffscreenStatusData, 'success'> | null>;
}
