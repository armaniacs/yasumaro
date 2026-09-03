import { StorageKeys } from '../../../utils/storage/types.js';
import type { DashboardSqliteRequest, DashboardSqliteSubtype } from '../dashboardSqliteProtocol.js';
import type { SqliteError } from '../../sqlite/offscreenGateway.js';
import { bytesToBase64, base64ToBytes } from '../../../utils/crypto/index.js';
import type { MaintenanceBatchDeps } from './deps.js';
import { toFailure, MAX_IMPORT_ROWS } from './deps.js';

/**
 * Subtypes this handler owns. The router derives its dispatch from this set
 * (everything not in this set, including unrecognised strings, also lands
 * here via the router's fallthrough and is reported by the `default` case).
 */
export const MAINTENANCE_BATCH_SUBTYPES: ReadonlySet<DashboardSqliteSubtype> = new Set([
  'migrate', 'import', 'restore_db', 'backup_db', 'backfill_metadata', 'cleanup_legacy', 'purge_now', 'content_purge_now',
]);

export function createMaintenanceBatchHandler(deps: MaintenanceBatchDeps) {
  return async (payload: DashboardSqliteRequest): Promise<unknown> => {
    const subtype = payload.subtype;
    switch (subtype) {
      case 'migrate': {
        const migrateResult = await deps.runMigration();
        return migrateResult.success
          ? { success: true, count: migrateResult.count, read: migrateResult.read, inserted: migrateResult.inserted, error: migrateResult.error }
          : { success: false, error: migrateResult.error || 'Migration failed' };
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
        // recently — see the module doc comment in deps.ts.
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
  };
}
