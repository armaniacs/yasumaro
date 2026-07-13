import { SqliteClient } from '../sqliteClient.js';
import { ObsidianClient } from '../obsidianClient.js';
import { formatEntriesToMarkdown } from '../../dashboard/obsidianFormatter.js';
import { logError, logInfo, ErrorCode } from '../../utils/logger.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { StorageKeys, getSettings } from '../../utils/storage.js';
import type { BrowsingLogEntry } from '../../utils/sqlite-types.js';
import { TOKEN_REQUIRED_SUBTYPES, MODAL_REQUIRED_SUBTYPES } from './dashboardSqliteProtocol.js';
import type { DashboardSqliteRequest } from './dashboardSqliteProtocol.js';

export { TOKEN_REQUIRED_SUBTYPES, MODAL_REQUIRED_SUBTYPES };

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const ALLOWED_UPDATE_FIELDS = ['url', 'title', 'summary', 'tags', 'domain', 'visit_duration', 'scroll_ratio', 'is_starred', 'is_deleted', 'obsidian_synced'];

export async function handleDashboardSqlite(
    payload: DashboardSqliteRequest & { confirmToken?: string },
    sqliteClient: SqliteClient,
    runMigration?: () => Promise<{ success: boolean; count: number; read?: number; inserted?: number; error?: string }>,
    validConfirmToken?: string,
    runBackfill?: () => Promise<{ updated: number; total: number }>,
    runCleanup?: () => Promise<{ removed: string[]; totalBytes: number }>
): Promise<unknown> {
    const subtype = payload.subtype;

    if (TOKEN_REQUIRED_SUBTYPES.has(subtype)) {
        const providedToken = payload.confirmToken;
        if (!providedToken || providedToken !== validConfirmToken) {
            logError(
                'Dashboard SQLite: token mismatch',
                { subtype, hasToken: Boolean(providedToken) },
                ErrorCode.INTERNAL_ERROR
            );
            return { success: false, error: 'Confirmation token mismatch' };
        }
    }

    try {
        switch (subtype) {
            case 'confirm_token': {
                if (!validConfirmToken) {
                    return { success: false, error: 'Confirm token not available' };
                }
                return { success: true, confirmToken: validConfirmToken };
            }
            case 'migrate': {
                if (!runMigration) {
                    return { success: false, error: 'Migration not available' };
                }
                const migrateResult = await runMigration();
                return migrateResult.success
                    ? { success: true, count: migrateResult.count, read: migrateResult.read, inserted: migrateResult.inserted, error: migrateResult.error }
                    : { success: false, error: migrateResult.error || 'Migration failed' };
            }
            case 'query': {
                const result = await sqliteClient.query({
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
                if (result === null) {
                    return { success: false, error: sqliteClient.lastError || 'Query failed' };
                }
                return { success: true, rows: result.rows, total: result.total };
            }
            case 'search': {
                const result = await sqliteClient.search(
                    payload.query || '',
                    payload.limit ?? 50,
                    payload.offset ?? 0
                );
                if (result === null) {
                    return { success: false, error: sqliteClient.lastError || 'Search failed' };
                }
                return { success: true, rows: result.rows, total: result.total };
            }
            case 'toggle_star': {
                const result = await sqliteClient.toggleStar(payload.id);
                if (!result) {
                    return { success: false, error: sqliteClient.lastError || 'Toggle star failed' };
                }
                return result;
            }
            case 'delete': {
                const ok = await sqliteClient.delete(payload.id);
                if (!ok) {
                    return { success: false, error: sqliteClient.lastError || 'Delete failed' };
                }
                return { success: true };
            }
            case 'update': {
                const changes = payload.changes || {};
                const invalidKeys = Object.keys(changes).filter((k) => !ALLOWED_UPDATE_FIELDS.includes(k));
                if (invalidKeys.length > 0) {
                    return { success: false, error: `Invalid update fields: ${invalidKeys.join(', ')}` };
                }
                const ok = await sqliteClient.update(
                    payload.id,
                    changes
                );
                if (!ok) {
                    return { success: false, error: sqliteClient.lastError || 'Update failed' };
                }
                return { success: true };
            }
            case 'get_count': {
                const count = await sqliteClient.getCount();
                if (count === null) {
                    return { success: false, error: sqliteClient.lastError || 'Get count failed' };
                }
                return { success: true, count };
            }
            case 'clear_all': {
                const ok = await sqliteClient.clearAll();
                if (!ok) {
                    return { success: false, error: sqliteClient.lastError || 'Clear all failed' };
                }
                return { success: true };
            }
            case 'import': {
                const rows = payload.rows;
                if (!Array.isArray(rows) || rows.length === 0) {
                    return { success: false, error: 'No rows provided' };
                }
                const BATCH = 50;
                let inserted = 0;
                let skipped = 0;
                for (let i = 0; i < rows.length; i += BATCH) {
                    const batch = rows.slice(i, i + BATCH);
                    for (const row of batch) {
                        try {
                            const result = await sqliteClient.insert({
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
                            if (result) inserted++;
                            else skipped++;
                        } catch {
                            skipped++;
                        }
                    }
                }
                if (sqliteClient.lastError && inserted === 0) {
                    return { success: false, error: sqliteClient.lastError };
                }
                return { success: true, inserted, skipped, total: rows.length };
            }
            case 'restore_db': {
                const data = payload.data;
                if (typeof data !== 'string' || data.length === 0) {
                    return { success: false, error: 'No data provided' };
                }
                const restored = await sqliteClient.restoreDb(base64ToBytes(data));
                return restored ? { success: true } : { success: false, error: 'Restore failed' };
            }
            case 'status': {
                const status = await sqliteClient.getStatus();
                if (status) {
                    return { success: true, ...status };
                }
                return { success: false, error: sqliteClient.lastError || 'Status check failed' };
            }
            case 'opfs_spike': {
                const report = await sqliteClient.runOpfsSpike();
                if (report) {
                    return { success: true, report };
                }
                return { success: false, error: sqliteClient.lastError || 'OPFS spike failed' };
            }
            case 'append_to_obsidian': {
                const ids = payload.ids;
                if (!Array.isArray(ids) || ids.length === 0) {
                    return { success: false, error: 'No IDs provided' };
                }

                // OBSIDIAN_ENABLED controls auto-recording only; manual append always proceeds.
                const allSettings = await getSettings();

                // Check if Obsidian API key is configured (uses decrypted value from getSettings)
                const apiKey = allSettings[StorageKeys.OBSIDIAN_API_KEY] as string | undefined;
                if (!apiKey || apiKey.length < 16) {
                    return { success: false, error: 'Obsidian API key not configured' };
                }

                // Fetch entries by IDs (targeted query, no full table scan)
                const allResult = await sqliteClient.query({ ids, limit: ids.length, orderBy: 'id', orderDir: 'ASC' });
                const selectedEntries = (allResult?.rows || []) as BrowsingLogEntry[];

                if (selectedEntries.length === 0) {
                    return { success: false, error: 'No matching entries found' };
                }

                const markdown = formatEntriesToMarkdown(selectedEntries);
                if (!markdown) {
                    return { success: false, error: 'Failed to format entries' };
                }

                try {
                    const obsidianClient = new ObsidianClient();
                    await obsidianClient.appendToDailyNote(markdown);
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
                const settings = await getSettings();
                const days = settings[StorageKeys.SQLITE_RETENTION_DAYS] ?? null;
                const max  = settings[StorageKeys.SQLITE_MAX_RECORDS]    ?? null;
                if (days === null && max === null) {
                    return { success: true, purged: 0, skipped: true };
                }
                const purgedResult = await sqliteClient.purgeOldRecords(
                    days !== null ? Number(days) : undefined,
                    max  !== null ? Number(max)  : undefined,
                );
                if (purgedResult === null) {
                    return { success: false, error: sqliteClient.lastError || 'Purge failed' };
                }
                return { success: true, purged: purgedResult.purged, skipped: false };
            }
            case 'content_purge_now': {
                const settings = await getSettings();
                const contentDays = settings[StorageKeys.CONTENT_RETENTION_DAYS] ?? null;
                const contentMax  = settings[StorageKeys.CONTENT_MAX_RECORDS]    ?? null;
                const includeStarred = settings[StorageKeys.CONTENT_PURGE_INCLUDE_STARRED] ?? false;
                if (contentDays === null && contentMax === null) {
                    return { success: true, purged: 0, skipped: true };
                }
                const contentResult = await sqliteClient.purgeContent(
                    contentDays !== null ? Number(contentDays) : undefined,
                    contentMax  !== null ? Number(contentMax)  : undefined,
                    includeStarred,
                );
                if (contentResult === null) {
                    return { success: false, error: sqliteClient.lastError || 'Content purge failed' };
                }
                return { success: true, purged: contentResult.purged, skipped: false };
            }
            case 'backup_db': {
                const data = await sqliteClient.backupDb();
                if (data) {
                    return { success: true, data: bytesToBase64(data) };
                }
                return { success: false, error: sqliteClient.lastError || 'Backup failed' };
            }
            case 'backfill_metadata': {
                if (!runBackfill) {
                    return { success: false, error: 'Backfill not available' };
                }
                const backfillResult = await runBackfill();
                return { success: true, ...backfillResult };
            }
            case 'cleanup_legacy': {
                if (!runCleanup) {
                    return { success: false, error: 'Cleanup not available' };
                }
                const cleanupResult = await runCleanup();
                return { success: true, ...cleanupResult };
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
}
