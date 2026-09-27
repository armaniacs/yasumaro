import { settingsRepository } from '../utils/storage/SettingsRepository.js';
import { StorageKeys } from '../utils/storage/types.js';
import { cleanupExpiredSettingsBackups } from '../utils/storage/settingsMigration.js';
import { ErrorCode } from '../utils/logger/types.js';
import { logInfo, logError } from '../utils/logger/api.js';
import { errorMessage } from '../utils/errorUtils.js';
import { purgeExpiredDownloadRecords, LOCAL_MARKDOWN_BUFFER_RETENTION_DAYS } from './localMarkdownExportRetention.js';
import { clearExpiredPages as defaultClearExpiredPages } from '../utils/pendingStorage.js';
import { DAILY_BUFFER_PREFIX } from './pipeline/steps/saveLocalMarkdownStep.js';
import type { CallResult } from './sqlite/offscreenGateway.js';

type PurgeFn = (retentionDays?: number, maxRecords?: number) => Promise<CallResult<{ purged: number }>>;
type ContentPurgeFn = (
    retentionDays?: number,
    maxRecords?: number,
    includeStarred?: boolean,
) => Promise<CallResult<{ purged: number }>>;

const BUFFER_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Local-calendar `YYYY-MM-DD`, matching how MarkdownBufferManager names a day. */
function toCalendarDate(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

function daysAgo(now: Date, days: number): string {
    // The local Date constructor, not a millisecond subtraction: buffer keys are
    // local-calendar names, so the cutoff has to be one too (and this stays
    // correct across month ends and DST shifts).
    return toCalendarDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
}

/**
 * Reclaim `local_export_YYYY-MM-DD` buffer keys that no longer belong in storage.
 *
 * A key is orphaned whenever its download failed or export mode was 'manual'
 * that day: `flushBufferedExports` removes a key only after a successful
 * download, and its per-date catch deliberately leaves the key in place.
 * Deleting at failure time would drop that day's unsaved data, so the
 * retention sweep here is the ONLY reclaim path — keep the two concerns apart
 * instead of folding "reclaim" into the failure branch.
 *
 * Only `chrome.storage.local.remove` is used: the exported files themselves are
 * not this sweep's business, and touching `chrome.downloads` here would delete
 * user-visible download history.
 *
 * @param now - injectable clock so the day boundary is testable without a sleep.
 * @returns how many buffer keys were removed.
 */
export async function sweepExpiredLocalExportBuffers(now: Date = new Date()): Promise<number> {
    const stored = await chrome.storage.local.get(DAILY_BUFFER_PREFIX);

    const today = toCalendarDate(now);
    const yesterday = daysAgo(now, 1);
    const cutoff = daysAgo(now, LOCAL_MARKDOWN_BUFFER_RETENTION_DAYS);

    // Today and yesterday are never eligible, whatever the window says: their
    // flush runs on its own schedule, so they can still legitimately hold
    // unflushed entries when the daily alarm fires. The window is a tuning knob;
    // this is the data-safety invariant under it.
    const expiredKeys = Object.keys(stored).filter((key) => {
        const date = key.slice(DAILY_BUFFER_PREFIX.length);
        if (!BUFFER_DATE_PATTERN.test(date)) return false;
        if (date === today || date === yesterday) return false;
        // Inclusive, so a key sitting exactly on the boundary is reclaimed —
        // the same "exactly N days is expired" rule the download records use.
        return date <= cutoff;
    });

    if (expiredKeys.length === 0) return 0;

    await chrome.storage.local.remove(expiredKeys);
    return expiredKeys.length;
}

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

        // VULN-004 follow-up: reclaim `local_export_YYYY-MM-DD` buffer keys past
        // LOCAL_MARKDOWN_BUFFER_RETENTION_DAYS, which no download failure path
        // reclaims on its own.
        const sweptBuffers = await sweepExpiredLocalExportBuffers();
        if (sweptBuffers > 0) {
            logInfo('local-export buffer sweep completed', { swept: sweptBuffers }, 'dailyPurgeHandler');
        }
    } catch (error) {
        logError('daily-purge failed', { error: errorMessage(error) }, ErrorCode.STORAGE_WRITE_FAILURE, 'dailyPurgeHandler');
    }
}
