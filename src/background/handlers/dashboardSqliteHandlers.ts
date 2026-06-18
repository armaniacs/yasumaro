import { SqliteClient } from '../sqliteClient.js';
import { ObsidianClient } from '../obsidianClient.js';
import { formatEntriesToMarkdown } from '../../dashboard/obsidianFormatter.js';
import { logError, logInfo, ErrorCode } from '../../utils/logger.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { StorageKeys, getSettings } from '../../utils/storage.js';
import type { BrowsingLogEntry } from '../../utils/sqlite-types.js';

const ALLOWED_UPDATE_FIELDS = ['url', 'title', 'summary', 'tags', 'domain', 'visit_duration', 'scroll_ratio', 'is_starred', 'is_deleted', 'obsidian_synced'];

export const TOKEN_REQUIRED_SUBTYPES = new Set([
    'toggle_star', 'update', 'delete', 'migrate', 'clear_all', 'import',
]);

export const MODAL_REQUIRED_SUBTYPES = new Set([
    'delete', 'migrate', 'clear_all',
]);

export async function handleDashboardSqlite(
    payload: Record<string, unknown>,
    sqliteClient: SqliteClient,
    runMigration?: () => Promise<{ success: boolean; count: number; read?: number; inserted?: number; error?: string }>,
    validConfirmToken?: string
): Promise<unknown> {
    const subtype = payload.subtype as string;

    if (TOKEN_REQUIRED_SUBTYPES.has(subtype)) {
        const providedToken = payload.confirmToken as string | undefined;
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
                    limit: (payload.limit as number) ?? 100,
                    offset: (payload.offset as number) ?? 0,
                    domain: payload.domain as string | undefined,
                    isStarred: payload.isStarred as boolean | undefined,
                    since: payload.since as number | undefined,
                    until: payload.until as number | undefined,
                    orderBy: (payload.orderBy as string) || 'created_at',
                    orderDir: (payload.orderDir as 'ASC' | 'DESC') || 'DESC',
                });
                return result
                    ? { success: true, rows: result.rows, total: result.total }
                    : { success: false, error: 'Query failed' };
            }
            case 'search': {
                const result = await sqliteClient.search(
                    payload.query as string || '',
                    (payload.limit as number) ?? 50,
                    (payload.offset as number) ?? 0
                );
                return result
                    ? { success: true, rows: result.rows, total: result.total }
                    : { success: false, error: 'Search failed' };
            }
            case 'toggle_star': {
                const result = await sqliteClient.toggleStar(payload.id as number);
                return result ?? { success: false, error: 'Toggle star failed' };
            }
            case 'delete': {
                const result = await sqliteClient.delete(payload.id as number);
                return { success: result };
            }
            case 'update': {
                const changes = (payload.changes || {}) as Record<string, unknown>;
                const invalidKeys = Object.keys(changes).filter((k) => !ALLOWED_UPDATE_FIELDS.includes(k));
                if (invalidKeys.length > 0) {
                    return { success: false, error: `Invalid update fields: ${invalidKeys.join(', ')}` };
                }
                const result = await sqliteClient.update(
                    payload.id as number,
                    changes
                );
                return { success: result };
            }
            case 'get_count': {
                const count = await sqliteClient.getCount();
                return { success: true, count: count ?? 0 };
            }
            case 'clear_all': {
                const ok = await sqliteClient.clearAll();
                return { success: ok };
            }
            case 'import': {
                const rows = payload.rows as Array<{
                    url: string; title?: string; summary?: string; tags?: string;
                    created_at: number; domain?: string; visit_duration?: number;
                    scroll_ratio?: number; is_starred?: number; is_deleted?: number;
                }> | undefined;
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
                return { success: true, inserted, skipped, total: rows.length };
            }
            case 'status': {
                const status = await sqliteClient.getStatus();
                if (status) {
                    return { success: true, ...status };
                } else {
                    return { success: false, error: 'Status check failed' };
                }
            }
            case 'opfs_spike': {
                const report = await sqliteClient.runOpfsSpike();
                return report
                    ? { success: true, report }
                    : { success: false, error: 'OPFS spike failed' };
            }
            case 'append_to_obsidian': {
                const ids = payload.ids as number[] | undefined;
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
                const result = await sqliteClient.purgeOldRecords(
                    days !== null ? Number(days) : undefined,
                    max  !== null ? Number(max)  : undefined,
                );
                return { success: true, purged: result?.purged ?? 0, skipped: false };
            }
            default:
                return { success: false, error: `Unknown subtype: ${subtype}` };
        }
    } catch (error) {
        logError('Dashboard SQLite error', {
            subtype,
            error: errorMessage(error),
        }, ErrorCode.UNKNOWN_ERROR);
        return { success: false, error: String(error) };
    }
}
