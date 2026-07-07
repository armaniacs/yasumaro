import { getSettings, StorageKeys } from '../utils/storage.js';
import { logInfo, logError, ErrorCode } from '../utils/logger.js';
import { errorMessage } from '../utils/errorUtils.js';

type PurgeFn = (retentionDays?: number, maxRecords?: number) => Promise<{ purged: number } | null>;
type ContentPurgeFn = (
  retentionDays?: number,
  maxRecords?: number,
  includeStarred?: boolean,
) => Promise<{ purged: number } | null>;

/**
 * Runs the daily SQLite purge according to user retention settings.
 * If both settings are null, purge is skipped (unlimited retention).
 */
export async function handleDailyPurgeAlarm(
  purgeOldRecords: PurgeFn,
  purgeContent?: ContentPurgeFn,
): Promise<void> {
    try {
        const settings = await getSettings();

        // Record-level purge (existing)
        const days = settings[StorageKeys.SQLITE_RETENTION_DAYS] ?? null;
        const max  = settings[StorageKeys.SQLITE_MAX_RECORDS]    ?? null;

        if (days !== null || max !== null) {
            const result = await purgeOldRecords(
                days  !== null ? days  : undefined,
                max   !== null ? max   : undefined,
            );
            logInfo('daily-purge completed', { purged: result?.purged ?? 0 }, 'dailyPurgeHandler');
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
                    purged: result?.purged ?? 0,
                }, 'dailyPurgeHandler');
            }
        }
    } catch (error) {
        logError('daily-purge failed', { error: errorMessage(error) }, ErrorCode.STORAGE_WRITE_FAILURE, 'dailyPurgeHandler');
    }
}
