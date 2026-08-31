import { settingsRepository } from '../utils/storage/SettingsRepository.js';
import { StorageKeys } from '../utils/storage/types.js';
import { cleanupExpiredSettingsBackups } from '../utils/storage/settingsMigration.js';
import { logInfo, logError, ErrorCode } from '../utils/logger.js';
import { errorMessage } from '../utils/errorUtils.js';
import { purgeExpiredDownloadRecords } from './localMarkdownExportRetention.js';
import { clearExpiredPages as defaultClearExpiredPages } from '../utils/pendingStorage.js';
import type { CallResult } from './sqliteClient.js';

type PurgeFn = (retentionDays?: number, maxRecords?: number) => Promise<CallResult<{ purged: number }>>;
type ContentPurgeFn = (
  retentionDays?: number,
  maxRecords?: number,
  includeStarred?: boolean,
) => Promise<CallResult<{ purged: number }>>;

/**
 * Runs the daily SQLite purge according to user retention settings.
 * If both settings are null, purge is skipped (unlimited retention).
 */
export async function handleDailyPurgeAlarm(
  purgeOldRecords: PurgeFn,
  purgeContent?: ContentPurgeFn,
  clearExpiredPages: () => Promise<void> = defaultClearExpiredPages,
): Promise<void> {
    try {
        const settings = await settingsRepository.getAll();

        // Expired pending pages accumulate forever without this call — the
        // read-side filter in getPendingPages() hides them but never deletes.
        await clearExpiredPages();

        // Record-level purge (existing)
        const days = settings[StorageKeys.SQLITE_RETENTION_DAYS] ?? null;
        const max  = settings[StorageKeys.SQLITE_MAX_RECORDS]    ?? null;

        if (days !== null || max !== null) {
            const result = await purgeOldRecords(
                days  !== null ? days  : undefined,
                max   !== null ? max   : undefined,
            );
            // A failed purge must not be logged as "0 purged" — that hides a
            // retention failure (PBI-02).
            logInfo('daily-purge completed', { purged: result.success ? result.data.purged : -1 }, 'dailyPurgeHandler');
        }

        // Content-level purge (PBI-3)
        if (purgeContent) {
            const contentDays = settings[StorageKeys.CONTENT_RETENTION_DAYS] ?? null;
            const contentMax  = settings[StorageKeys.CONTENT_MAX_RECORDS]    ?? null;
            const includeStarred = settings[StorageKeys.CONTENT_PURGE_INCLUDE_STARRED] ?? false;

            if (contentDays !== null || contentMax !== null) {
                const result = await purgeContent(
                    contentDays !== null ? contentDays : undefined,
                    contentMax  !== null ? contentMax  : undefined,
                    includeStarred,
                );
                logInfo('daily-content-purge completed', {
                    purged: result.success ? result.data.purged : -1,
                }, 'dailyPurgeHandler');
            }
        }

        // PBI-15: clean up expired settings migration backups
        await cleanupExpiredSettingsBackups();

        // VULN-004: remove local Markdown export download records older than
        // LOCAL_MARKDOWN_EXPORT_RETENTION_DAYS.
        await purgeExpiredDownloadRecords();
    } catch (error) {
        logError('daily-purge failed', { error: errorMessage(error) }, ErrorCode.STORAGE_WRITE_FAILURE, 'dailyPurgeHandler');
    }
}
