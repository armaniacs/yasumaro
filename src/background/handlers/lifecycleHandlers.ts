/**
 * Extension Lifecycle Handlers for Service Worker
 *
 * Extracted from service-worker.ts for modularization (PBI-26).
 * Handles install, update, and startup lifecycle events.
 */
import type { RecordingCacheInstance } from '../recordingCache.js';
import { updateDomainFilterCache } from '../../utils/storage/domainFilterCache.js';
import { getSettings } from '../../utils/storage/settingsStore.js';
import { migrateLegacyPrivacyConsent } from '../../popup/privacyConsent.js';
import { cleanupOldDeniedEntries, cleanupDismissedEntries } from '../../utils/permissionManager.js';
import { RateLimiter } from '../rateLimiter.js';
import { logInfo, logDebug, logWarn, logError, ErrorCode } from '../../utils/logger.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { updateConsentBadge } from '../consentBadge.js';
import { flushPendingRecords } from '../pendingSqliteQueue.js';
import type { SqliteClient } from '../sqliteClient.js';
import { StorageKeys } from '../../utils/storage/types.js';
import { syncOllamaOriginRule } from '../net/ollamaOriginRule.js';
import { getRegistryEntry } from '../ai/providerRegistry.js';

const OLLAMA_DEFAULT_BASE_URL = getRegistryEntry('ollama')?.defaultBaseUrl ?? 'http://localhost:11434/v1';

/**
 * 現在のOllama baseUrl設定に合わせてOriginヘッダー削除ルールを同期する。
 * 失敗してもextensionの他機能をブロックしないよう、ここで例外を握りつぶしログのみ行う。
 */
async function syncOllamaOriginRuleFromSettings(context: string): Promise<void> {
    try {
        const settings = await getSettings();
        await syncOllamaOriginRule(settings[StorageKeys.OLLAMA_BASE_URL] ?? OLLAMA_DEFAULT_BASE_URL);
    } catch (error) {
        logWarn(
            `Ollama Origin header rule sync failed on ${context}`,
            { error: errorMessage(error) },
            undefined,
            'service-worker'
        );
    }
}

export interface LifecycleHandlerContext {
    /** Mutable flag — the handler may set it to true */
    isCacheInitialized: { value: boolean; restore: () => Promise<void> };
    rateLimiter: RateLimiter;
    sqliteClient: SqliteClient;
    recordingCache?: RecordingCacheInstance | null;
}

export function createLifecycleHandlers(ctx: LifecycleHandlerContext) {
    /**
     * Initialize extension on install/update.
     */
    async function handleInstalled(details: { reason?: string; previousVersion?: string }): Promise<void> {
        if (details.reason === 'install') {
            logInfo('Service Worker installed', {}, 'service-worker');
            await syncOllamaOriginRuleFromSettings('install');
        } else if (details.reason === 'update') {
            logInfo(`Service Worker updated from ${details.previousVersion}`, {}, 'service-worker');

            // 更新時はキャッシュをクリアして再初期化
            if (ctx.recordingCache) ctx.recordingCache.invalidateSettingsCache();
            const settings = await getSettings();
            await updateDomainFilterCache(settings);
            await syncOllamaOriginRuleFromSettings('update');

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

        await ctx.isCacheInitialized.restore();

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
        if (!ctx.isCacheInitialized.value) {
            try {
                // 関連キャッシュを無効化して再読み込みを強制
                if (ctx.recordingCache) await ctx.recordingCache.invalidateSettingsCache();
                const settings = await getSettings();
                await updateDomainFilterCache(settings);
                ctx.isCacheInitialized.value = true;

                // Reload recording cache from session
                if (ctx.recordingCache) await ctx.recordingCache.loadCacheFromSession();

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
        } else {
            logDebug('Cache already initialized, skipping startup rehydration', {}, 'service-worker');
        }
    }

    return { handleInstalled, handleStartup };
}

/**
 * Restore the recording cache from session storage on service-worker wake-up.
 *
 * `chrome.runtime.onStartup` only fires when the browser profile starts, so
 * cache rehydration would be missed on every later wake (tab event, alarm,
 * message). Service-worker module top-level code runs on each wake, so
 * service-worker.ts invokes this at module scope to rehydrate the cache.
 */
export async function restoreRecordingCacheOnWake(cache?: RecordingCacheInstance | null): Promise<void> {
    if (cache) {
        await cache.loadCacheFromSession();
    }
}
