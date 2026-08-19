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
 */
export interface SqliteRpcClient {
  init(): Promise<SqliteRpcResult<boolean>>;
  insertResult(record: BrowsingLogRecord, traceId?: string): Promise<SqliteRpcResult<{ id: number }>>;
  insertBatchResult(records: BrowsingLogRecord[]): Promise<SqliteRpcResult<{ count: number }>>;
  queryResult<T = BrowsingLogRecord>(q: StorageQuery): Promise<SqliteRpcResult<{ rows: T[]; total: number }>>;
  searchResult(
    searchQuery: string,
    limit?: number,
    offset?: number,
    options?: { orderBy?: 'rank' | 'created_at'; orderDir?: 'ASC' | 'DESC' },
  ): Promise<SqliteRpcResult<{ rows: BrowsingLogRecord[]; total: number }>>;
  updateResult(id: number, changes: Partial<Record<string, unknown>>, traceId?: string): Promise<SqliteRpcResult<void>>;
  deleteResult(id: number): Promise<SqliteRpcResult<void>>;
  toggleStarResult(id: number): Promise<SqliteRpcResult<{ is_starred: number }>>;
  getCountResult(): Promise<SqliteRpcResult<number>>;
  exportDbResult(): Promise<SqliteRpcResult<Uint8Array>>;
  backupDbResult(): Promise<SqliteRpcResult<Uint8Array>>;
  restoreDbResult(data: Uint8Array): Promise<SqliteRpcResult<void>>;
  clearAllResult(): Promise<SqliteRpcResult<void>>;
  runOpfsSpikeResult(): Promise<SqliteRpcResult<OpfsSpikeReport>>;
  purgeOldRecordsResult(retentionDays?: number, maxRecords?: number): Promise<SqliteRpcResult<{ purged: number }>>;
  purgeContentResult(
    retentionDays?: number,
    maxRecords?: number,
    includeStarred?: boolean,
  ): Promise<SqliteRpcResult<{ purged: number }>>;
  insertAuditLogResult(record: { provider: string; url: string; created_at: number }): Promise<SqliteRpcResult<{ id: number }>>;
  queryAuditLogResult(
    options: { limit?: number; offset?: number },
  ): Promise<SqliteRpcResult<{ rows: Array<{ id: number; provider: string; url: string; created_at: number }>; total: number }>>;
}
