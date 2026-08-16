import { logError, logInfo, ErrorCode } from '../../utils/logger.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { StorageKeys, getSettings } from '../../utils/storage.js';
import { formatEntriesToMarkdown } from '../../dashboard/obsidianFormatter.js';
import { ObsidianClient } from '../obsidianClient.js';
import type { BrowsingLogEntry } from '../../utils/sqlite-types.js';
import { TOKEN_REQUIRED_SUBTYPES } from './dashboardSqliteProtocol.js';
import type { DashboardSqliteRequest } from './dashboardSqliteProtocol.js';
import { bytesToBase64, base64ToBytes } from '../../utils/crypto/index.js';
import type { CallResult, SqliteError } from '../sqliteClient.js';

const ALLOWED_UPDATE_FIELDS = ['url', 'title', 'summary', 'tags', 'domain', 'visit_duration', 'scroll_ratio', 'is_starred', 'is_deleted', 'obsidian_synced'];
const MAX_APPEND_IDS = 100;
// VULN-006: cap bulk import rows to prevent SW/offscreen queue saturation
// (the append path already caps at MAX_APPEND_IDS).
const MAX_IMPORT_ROWS = 5000;

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
function toFailure(result: { success: false; error: SqliteError }): { success: false; error: string; retriable: boolean } {
  return { success: false, error: result.error.message, retriable: result.error.retriable };
}

export interface DashboardSqliteHandlerDeps {
  query: (params: Record<string, unknown>) => Promise<DepsResult<{ rows: unknown[]; total: number }>>;
  search: (query: string, limit: number, offset: number, options?: { orderBy?: 'rank' | 'created_at'; orderDir?: 'ASC' | 'DESC' }) => Promise<DepsResult<{ rows: unknown[]; total: number }>>;
  toggleStar: (id: number) => Promise<DepsResult<{ is_starred: number }>>;
  delete: (id: number) => Promise<DepsResult<void>>;
  update: (id: number, changes: Record<string, unknown>) => Promise<DepsResult<void>>;
  getCount: () => Promise<DepsResult<number>>;
  clearAll: () => Promise<DepsResult<void>>;
  insert: (record: Record<string, unknown>) => Promise<DepsResult<{ id: number }>>;
  getSettings: () => Promise<Record<string, unknown>>;
  formatEntriesToMarkdown: (entries: BrowsingLogEntry[]) => string | null;
  appendToDailyNote: (markdown: string) => Promise<void>;
  restoreDb: (data: Uint8Array) => Promise<DepsResult<void>>;
  /**
   * Deliberately not a DepsResult: getStatus() reports initialization
   * failure inside its success value (as `initError`) so the diagnostics
   * panel can display it, rather than as a DepsResult failure — see
   * SqliteClient.getStatus().
   */
  getStatus: () => Promise<Record<string, unknown> | null>;
  runOpfsSpike: () => Promise<DepsResult<Record<string, unknown>>>;
  purgeOldRecords: (days?: number, max?: number) => Promise<DepsResult<{ purged: number }>>;
  purgeContent: (days?: number, max?: number, includeStarred?: boolean) => Promise<DepsResult<{ purged: number }>>;
  backupDb: () => Promise<DepsResult<Uint8Array>>;
  runMigration: () => Promise<
    | { success: true; count: number; read: number; inserted: number; error?: string }
    | { success: false; error?: string; count?: number; read?: number; inserted?: number }
  >;
  getConfirmToken: () => Promise<string>;
  runBackfill: () => Promise<{ updated: number; total: number }>;
  runCleanup: () => Promise<{ removed: string[]; totalBytes: number }>;
  queryAuditLog: (options: { limit?: number; offset?: number }) => Promise<DepsResult<{ rows: Array<{ id: number; provider: string; url: string; created_at: number }>; total: number }>>;
}

export function createDashboardSqliteHandler(deps: DashboardSqliteHandlerDeps) {
  return async (
    payload: DashboardSqliteRequest & { confirmToken?: string },
  ): Promise<unknown> => {
    const subtype = payload.subtype;

    if (TOKEN_REQUIRED_SUBTYPES.has(subtype)) {
      const providedToken = payload.confirmToken;
      const validConfirmToken = await deps.getConfirmToken();
      if (!providedToken || providedToken !== validConfirmToken) {
        logError(
          'Dashboard SQLite: token mismatch',
          { subtype, hasToken: Boolean(providedToken) },
          ErrorCode.INTERNAL_ERROR,
        );
        return { success: false, error: 'Confirmation token mismatch' };
      }
    }

    try {
      switch (subtype) {
        case 'confirm_token': {
          const token = await deps.getConfirmToken();
          if (!token) {
            return { success: false, error: 'Confirm token not available' };
          }
          return { success: true, confirmToken: token };
        }
        case 'migrate': {
          const migrateResult = await deps.runMigration();
          return migrateResult.success
            ? { success: true, count: migrateResult.count, read: migrateResult.read, inserted: migrateResult.inserted, error: migrateResult.error }
            : { success: false, error: migrateResult.error || 'Migration failed' };
        }
        case 'query': {
          const result = await deps.query({
            limit: payload.limit ?? 100,
            offset: payload.offset ?? 0,
            domain: payload.domain,
            isStarred: payload.isStarred,
            since: payload.since,
            until: payload.until,
            orderBy: payload.orderBy || 'created_at',
            orderDir: payload.orderDir || 'DESC',
            tagFilter: payload.tagFilter,
          });
          if (!result.success) {
            return toFailure(result);
          }
          return { success: true, rows: result.data.rows, total: result.data.total };
        }
        case 'search': {
          const result = await deps.search(
            payload.query || '',
            payload.limit ?? 50,
            payload.offset ?? 0,
            { orderBy: payload.orderBy, orderDir: payload.orderDir },
          );
          if (!result.success) {
            return toFailure(result);
          }
          return { success: true, rows: result.data.rows, total: result.data.total };
        }
        case 'toggle_star': {
          const result = await deps.toggleStar(payload.id);
          if (!result.success) {
            return toFailure(result);
          }
          return { success: true, ...result.data };
        }
        case 'delete': {
          const result = await deps.delete(payload.id);
          if (!result.success) {
            return toFailure(result);
          }
          return { success: true };
        }
        case 'update': {
          const changes = payload.changes || {};
          const invalidKeys = Object.keys(changes).filter((k) => !ALLOWED_UPDATE_FIELDS.includes(k));
          if (invalidKeys.length > 0) {
            return { success: false, error: `Invalid update fields: ${invalidKeys.join(', ')}` };
          }
          const result = await deps.update(payload.id, changes);
          if (!result.success) {
            return toFailure(result);
          }
          return { success: true };
        }
        case 'get_count': {
          const result = await deps.getCount();
          if (!result.success) {
            return toFailure(result);
          }
          return { success: true, count: result.data };
        }
        case 'clear_all': {
          const result = await deps.clearAll();
          if (!result.success) {
            return toFailure(result);
          }
          return { success: true };
        }
        case 'import': {
          const rows = payload.rows;
          if (!Array.isArray(rows) || rows.length === 0) {
            return { success: false, error: 'No rows provided' };
          }
          // VULN-006: reject oversized collections instead of looping unbounded.
          if (rows.length > MAX_IMPORT_ROWS) {
            return { success: false, error: `Maximum ${MAX_IMPORT_ROWS} rows allowed` };
          }
          const BATCH = 50;
          let inserted = 0;
          let skipped = 0;
          // Kept in a local instead of shared state: the reason belongs to
          // this call, not to whatever else on the client failed most
          // recently — see the module doc comment.
          let lastInsertError: SqliteError | null = null;
          for (let i = 0; i < rows.length; i += BATCH) {
            const batch = rows.slice(i, i + BATCH);
            for (const row of batch) {
              try {
                const result = await deps.insert({
                  url: row.url,
                  title: row.title ?? null,
                  summary: row.summary ?? null,
                  tags: row.tags ?? null,
                  created_at: row.created_at,
                  domain: row.domain ?? null,
                  visit_duration: row.visit_duration ?? null,
                  scroll_ratio: row.scroll_ratio ?? null,
                  is_starred: row.is_starred ?? 0,
                  is_deleted: row.is_deleted ?? 0,
                });
                if (result.success) {
                  inserted++;
                } else {
                  skipped++;
                  lastInsertError = result.error;
                }
              } catch {
                skipped++;
              }
            }
          }
          if (lastInsertError && inserted === 0) {
            return { success: false, error: lastInsertError.message };
          }
          return { success: true, inserted, skipped, total: rows.length };
        }
        case 'restore_db': {
          const data = payload.data;
          if (typeof data !== 'string' || data.length === 0) {
            return { success: false, error: 'No data provided' };
          }
          // VULN-008 fix: reject oversized base64 payload before decoding
          // 100MB raw → ~134MB base64; use 150MB base64 as safe ceiling
          const MAX_RESTORE_BASE64_LENGTH = 150 * 1024 * 1024;
          if (data.length > MAX_RESTORE_BASE64_LENGTH) {
            return { success: false, error: `Restore data exceeds maximum size (${Math.round(data.length / 1024 / 1024)}MB > 100MB)` };
          }
          const result = await deps.restoreDb(base64ToBytes(data));
          if (!result.success) {
            return toFailure(result);
          }
          return { success: true };
        }
        case 'status': {
          const status = await deps.getStatus();
          if (status) {
            return { success: true, ...status };
          }
          // Unreachable via a real SqliteClient (getStatus() always resolves
          // to an object, even on failure — see its doc comment), but the
          // type keeps `| null` since deps.getStatus is not a DepsResult.
          return { success: false, error: 'Status check failed' };
        }
        case 'opfs_spike': {
          const result = await deps.runOpfsSpike();
          if (!result.success) {
            return toFailure(result);
          }
          return { success: true, report: result.data };
        }
        case 'append_to_obsidian': {
          const ids = payload.ids;
          // Check 1: array shape
          if (!Array.isArray(ids) || ids.length === 0) {
            return { success: false, error: 'No IDs provided' };
          }
          // Check 2: upper bound (before type check — safe on length property)
          if (ids.length > MAX_APPEND_IDS) {
            return { success: false, error: `Maximum ${MAX_APPEND_IDS} IDs allowed` };
          }
          // Check 3: all elements are finite numbers (safe — at most 100 elements)
          if (!ids.every((id: unknown): id is number => typeof id === 'number' && Number.isFinite(id))) {
            return { success: false, error: 'All IDs must be finite numbers' };
          }

          const allSettings = await deps.getSettings();
          const apiKey = allSettings[StorageKeys.OBSIDIAN_API_KEY] as string | undefined;
          if (!apiKey || apiKey.length < 16) {
            return { success: false, error: 'Obsidian API key not configured' };
          }

          const allResult = await deps.query({ ids, limit: ids.length, orderBy: 'id', orderDir: 'ASC' });
          if (!allResult.success) {
            // Report the read failure rather than letting it fall through to
            // "No matching entries found", which suggests the ids were wrong.
            return { success: false, error: allResult.error.message };
          }
          const selectedEntries = allResult.data.rows as BrowsingLogEntry[];

          if (selectedEntries.length === 0) {
            return { success: false, error: 'No matching entries found' };
          }

          const markdown = deps.formatEntriesToMarkdown(selectedEntries);
          if (!markdown) {
            return { success: false, error: 'Failed to format entries' };
          }

          try {
            await deps.appendToDailyNote(markdown);
            logInfo('Appended entries to Obsidian', { count: selectedEntries.length });
            return { success: true, appended: selectedEntries.length };
          } catch (error) {
            logError('Failed to append to Obsidian', {
              error: errorMessage(error),
              count: selectedEntries.length,
            }, ErrorCode.UNKNOWN_ERROR);
            return { success: false, error: errorMessage(error) };
          }
        }
        case 'purge_now': {
          const settings = await deps.getSettings();
          const days = settings[StorageKeys.SQLITE_RETENTION_DAYS] ?? null;
          const max  = settings[StorageKeys.SQLITE_MAX_RECORDS]    ?? null;
          if (days === null && max === null) {
            return { success: true, purged: 0, skipped: true };
          }
          const result = await deps.purgeOldRecords(
            days !== null ? Number(days) : undefined,
            max  !== null ? Number(max)  : undefined,
          );
          if (!result.success) {
            return toFailure(result);
          }
          return { success: true, purged: result.data.purged, skipped: false };
        }
        case 'audit_log_query': {
          const result = await deps.queryAuditLog({
            limit: payload.limit,
            offset: payload.offset,
          });
          if (!result.success) {
            return toFailure(result);
          }
          return { success: true, rows: result.data.rows, total: result.data.total };
        }
        case 'content_purge_now': {
          const settings = await deps.getSettings();
          const contentDays = settings[StorageKeys.CONTENT_RETENTION_DAYS] ?? null;
          const contentMax  = settings[StorageKeys.CONTENT_MAX_RECORDS]    ?? null;
          const includeStarred = settings[StorageKeys.CONTENT_PURGE_INCLUDE_STARRED] as boolean | undefined ?? false;
          if (contentDays === null && contentMax === null) {
            return { success: true, purged: 0, skipped: true };
          }
          const result = await deps.purgeContent(
            contentDays !== null ? Number(contentDays) : undefined,
            contentMax  !== null ? Number(contentMax)  : undefined,
            includeStarred,
          );
          if (!result.success) {
            return toFailure(result);
          }
          return { success: true, purged: result.data.purged, skipped: false };
        }
        case 'backup_db': {
          const result = await deps.backupDb();
          if (result.success) {
            return { success: true, data: bytesToBase64(result.data) };
          }
          return toFailure(result);
        }
        case 'backfill_metadata': {
          try {
            const backfillResult = await deps.runBackfill();
            return { success: true, ...backfillResult };
          } catch {
            return { success: false, error: 'Backfill not available' };
          }
        }
        case 'cleanup_legacy': {
          try {
            const cleanupResult = await deps.runCleanup();
            return { success: true, ...cleanupResult };
          } catch {
            return { success: false, error: 'Cleanup not available' };
          }
        }
        default:
          return { success: false, error: `Unknown subtype: ${subtype}` };
      }
    } catch (error) {
      logError('Dashboard SQLite error', {
        subtype,
        error: errorMessage(error),
      }, ErrorCode.UNKNOWN_ERROR);
      return { success: false, error: 'An internal error occurred' };
    }
  };
}

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
  sqliteClient: import('../sqliteClient.js').SqliteClient,
  serviceWorkerDeps: SqliteClientBackedDeps,
): DashboardSqliteHandlerDeps {
  return {
    // Every *Result variant keeps the failure reason attached to the call
    // that produced it, rather than routing it through shared client state.
    query: (params) => sqliteClient.queryResult(params),
    search: (query, limit, offset) => sqliteClient.searchResult(query, limit, offset),
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
