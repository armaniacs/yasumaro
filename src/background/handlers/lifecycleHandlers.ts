/**
 * Extension Lifecycle Handlers for Service Worker
 *
 * Extracted from service-worker.ts for modularization (PBI-26).
 * Handles install, update, and startup lifecycle events.
 */
import { RecordingLogic } from '../recordingLogic.js';
import { getSettings, updateDomainFilterCache } from '../../utils/storage.js';
import { migrateLegacyPrivacyConsent } from '../../popup/privacyConsent.js';
import { cleanupOldDeniedEntries, cleanupDismissedEntries } from '../../utils/permissionManager.js';
import { RateLimiter } from '../rateLimiter.js';
import { logInfo, logDebug, logWarn, logError, ErrorCode } from '../../utils/logger.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { updateConsentBadge } from '../consentBadge.js';
import { flushPendingRecords } from '../pendingSqliteQueue.js';
import type { SqliteClient } from '../sqliteClient.js';

export interface LifecycleHandlerContext {
    /** Mutable flag — the handler may set it to true */
    isCacheInitialized: { value: boolean };
    rateLimiter: RateLimiter;
    sqliteClient: SqliteClient;
}

export function createLifecycleHandlers(ctx: LifecycleHandlerContext) {
    /**
     * Initialize extension on install/update.
     */
    async function handleInstalled(details: { reason?: string; previousVersion?: string }): Promise<void> {
        if (details.reason === 'install') {
            logInfo('Service Worker installed', {}, 'service-worker');
        } else if (details.reason === 'update') {
            logInfo(`Service Worker updated from ${details.previousVersion}`, {}, 'service-worker');

            // 更新時はキャッシュをクリアして再初期化
            RecordingLogic.invalidateSettingsCache();
            const settings = await getSettings();
            await updateDomainFilterCache(settings);

            // Migrate legacy privacy consent for existing users
            // This ensures users who had boolean consent get the new object format
            // with version info, so isRecordingAllowed() works correctly
            try {
                await migrateLegacyPrivacyConsent();
            } catch (error) {
                await logWarn(
                    'Legacy privacy consent migration failed',
                    { error: errorMessage(error) },
                    ErrorCode.UNKNOWN_ERROR,
                    'service-worker'
                );
            }
        }

        await updateConsentBadge();
    }

    /**
     * Service Worker startup - rehydrate caches and cleanup.
     */
    async function handleStartup(): Promise<void> {
        logInfo('Service Worker startup - rehydrating caches', {}, 'service-worker');

        await updateConsentBadge();

        // Retry records that failed to insert while SQLite was unavailable (M14).
        // Runs regardless of cache-init state, since it's independent of it.
        try {
            await flushPendingRecords(ctx.sqliteClient);
        } catch (error) {
            logWarn(
                'Pending SQLite queue flush failed on startup',
                { error: errorMessage(error) },
                undefined,
                'service-worker'
            );
        }

        // 既にキャッシュが初期化済みの場合はスキップ（onInstalledで実行済み）
        if (ctx.isCacheInitialized.value) {
            logDebug('Cache already initialized, skipping startup rehydration', {}, 'service-worker');
            return;
        }

        try {
            // 関連キャッシュを無効化して再読み込みを強制
            RecordingLogic.invalidateSettingsCache();
            const settings = await getSettings();
            await updateDomainFilterCache(settings);
            ctx.isCacheInitialized.value = true;

            // Reload recording cache from session
            await RecordingLogic.loadCacheFromSession();

            // Reload rate limiter from session
            await ctx.rateLimiter.reload();

            logInfo('Service Worker startup - cache rehydration complete', {}, 'service-worker');
        } catch (error) {
            await logError(
                'Service Worker startup - cache rehydration failed',
                { error: errorMessage(error) },
                ErrorCode.STORAGE_READ_FAILURE,
                'service-worker'
            );
        }

        // 期限切れの権限データをクリーンアップ（起動時のみ実行）
        try {
            await cleanupOldDeniedEntries(90);
            await cleanupDismissedEntries(7);
            logDebug('Permission cleanup completed on startup', {}, 'service-worker');
        } catch (error) {
            logWarn(
                'Permission cleanup failed on startup',
                { error: errorMessage(error) },
                undefined,
                'service-worker'
            );
        }
    }

    return { handleInstalled, handleStartup };
}
