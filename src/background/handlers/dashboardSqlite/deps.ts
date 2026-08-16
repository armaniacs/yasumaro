import { StorageKeys, getSettings } from '../../../utils/storage.js';
import { formatEntriesToMarkdown } from '../../../dashboard/obsidianFormatter.js';
import { ObsidianClient } from '../../obsidianClient.js';
import type { BrowsingLogEntry } from '../../../utils/sqlite-types.js';
import { bytesToBase64, base64ToBytes } from '../../../utils/crypto/index.js';
import type { CallResult, SqliteError } from '../../sqliteClient.js';

export const ALLOWED_UPDATE_FIELDS = ['url', 'title', 'summary', 'tags', 'domain', 'visit_duration', 'scroll_ratio', 'is_starred', 'is_deleted', 'obsidian_synced'];
export const MAX_APPEND_IDS = 100;
// VULN-006: cap bulk import rows to prevent SW/offscreen queue saturation
// (the append path already caps at MAX_APPEND_IDS).
export const MAX_IMPORT_ROWS = 5000;

/**
 * Every result the SqliteClient-backed deps return carries its own failure
 * reason. The call that produced the failure is the only place that knows
 * why it failed, so the reason travels with the return value instead of
 * being read back out of shared state afterward.
 */
export type DepsResult<T> = CallResult<T>;

/**
 * Common failure mapping: every *Result deps call classifies its failure
 * (kind, message, retriable), so the handler only forwards the message and
 * retriable flag instead of reinterpreting them per case.
 */
export function toFailure(result: { success: false; error: SqliteError }): { success: false; error: string; retriable: boolean } {
  return { success: false, error: result.error.message, retriable: result.error.retriable };
}

/** Deps consumed by the read-only subtype group (never mutates, never needs a confirmToken). */
export interface ReadOnlyDeps {
  query: (params: Record<string, unknown>) => Promise<DepsResult<{ rows: unknown[]; total: number }>>;
  search: (query: string, limit: number, offset: number, options?: { orderBy?: 'rank' | 'created_at'; orderDir?: 'ASC' | 'DESC' }) => Promise<DepsResult<{ rows: unknown[]; total: number }>>;
  getCount: () => Promise<DepsResult<number>>;
  /**
   * Deliberately not a DepsResult: getStatus() reports initialization
   * failure inside its success value (as `initError`) so the diagnostics
   * panel can display it, rather than as a DepsResult failure — see
   * SqliteClient.getStatus().
   */
  getStatus: () => Promise<Record<string, unknown> | null>;
  runOpfsSpike: () => Promise<DepsResult<Record<string, unknown>>>;
  queryAuditLog: (options: { limit?: number; offset?: number }) => Promise<DepsResult<{ rows: Array<{ id: number; provider: string; url: string; created_at: number }>; total: number }>>;
  getConfirmToken: () => Promise<string>;
}

/** Deps consumed by the everyday dashboard mutation group (toggle_star/delete/update/clear_all/append_to_obsidian). */
export interface CoreCrudDeps {
  toggleStar: (id: number) => Promise<DepsResult<{ is_starred: number }>>;
  delete: (id: number) => Promise<DepsResult<void>>;
  update: (id: number, changes: Record<string, unknown>) => Promise<DepsResult<void>>;
  clearAll: () => Promise<DepsResult<void>>;
  query: (params: Record<string, unknown>) => Promise<DepsResult<{ rows: unknown[]; total: number }>>;
  getSettings: () => Promise<Record<string, unknown>>;
  formatEntriesToMarkdown: (entries: BrowsingLogEntry[]) => string | null;
  appendToDailyNote: (markdown: string) => Promise<void>;
}

/** Deps consumed by the maintenance/migration/backup group. */
export interface MaintenanceBatchDeps {
  insert: (record: Record<string, unknown>) => Promise<DepsResult<{ id: number }>>;
  getSettings: () => Promise<Record<string, unknown>>;
  restoreDb: (data: Uint8Array) => Promise<DepsResult<void>>;
  purgeOldRecords: (days?: number, max?: number) => Promise<DepsResult<{ purged: number }>>;
  purgeContent: (days?: number, max?: number, includeStarred?: boolean) => Promise<DepsResult<{ purged: number }>>;
  backupDb: () => Promise<DepsResult<Uint8Array>>;
  runMigration: () => Promise<
    | { success: true; count: number; read: number; inserted: number; error?: string }
    | { success: false; error?: string; count?: number; read?: number; inserted?: number }
  >;
  runBackfill: () => Promise<{ updated: number; total: number }>;
  runCleanup: () => Promise<{ removed: string[]; totalBytes: number }>;
}

/** Union of the three groups — what createDashboardSqliteHandler needs as a whole. Unchanged external shape. */
export type DashboardSqliteHandlerDeps = ReadOnlyDeps & CoreCrudDeps & MaintenanceBatchDeps;

/**
 * The operations this handler needs that a SqliteClient can supply.
 *
 * Everything outside this set (migration, confirm tokens, backfill, cleanup)
 * is owned by the Service Worker and has to be passed in separately.
 */
export interface SqliteClientBackedDeps {
  runMigration: DashboardSqliteHandlerDeps['runMigration'];
  getConfirmToken: DashboardSqliteHandlerDeps['getConfirmToken'];
  runBackfill: DashboardSqliteHandlerDeps['runBackfill'];
  runCleanup: DashboardSqliteHandlerDeps['runCleanup'];
}

/**
 * Builds the handler's dependencies from a SqliteClient.
 *
 * Both the Service Worker and the tests go through this, so there is one
 * answer to "how is this handler wired". Previously the two were assembled
 * independently and had drifted: the test-only wrapper stubbed migration,
 * confirm-token, backfill and cleanup, so the Service Worker's real
 * implementations of those four were never exercised by any test.
 */
export function createSqliteClientDeps(
  sqliteClient: import('../../sqliteClient.js').SqliteClient,
  serviceWorkerDeps: SqliteClientBackedDeps,
): DashboardSqliteHandlerDeps {
  return {
    // Every *Result variant keeps the failure reason attached to the call
    // that produced it, rather than routing it through shared client state.
    query: (params) => sqliteClient.queryResult(params),
    search: (query, limit, offset, options) => sqliteClient.searchResult(query, limit, offset, options),
    toggleStar: (id) => sqliteClient.toggleStarResult(id),
    delete: (id) => sqliteClient.deleteResult(id),
    update: (id, changes) => sqliteClient.updateResult(id, changes),
    getCount: () => sqliteClient.getCountResult(),
    clearAll: () => sqliteClient.clearAllResult(),
    insert: (record) => sqliteClient.insertResult(record as any),
    restoreDb: (data) => sqliteClient.restoreDbResult(data),
    // Deliberately not *Result: getStatus() reports initialization failure
    // inside its success value so the diagnostics panel can display it.
    getStatus: () => sqliteClient.getStatus(),
    runOpfsSpike: () => sqliteClient.runOpfsSpikeResult() as Promise<DepsResult<Record<string, unknown>>>,
    purgeOldRecords: (days, max) => sqliteClient.purgeOldRecordsResult(days, max),
    purgeContent: (days, max, includeStarred) => sqliteClient.purgeContentResult(days, max, includeStarred),
    backupDb: () => sqliteClient.backupDbResult(),
    getSettings: () => getSettings(),
    formatEntriesToMarkdown: (entries) => formatEntriesToMarkdown(entries),
    queryAuditLog: (options) => sqliteClient.queryAuditLogResult(options),
    appendToDailyNote: async (markdown) => {
      const obsidianClient = new ObsidianClient();
      await obsidianClient.appendToDailyNote(markdown);
    },
    ...serviceWorkerDeps,
  };
}
