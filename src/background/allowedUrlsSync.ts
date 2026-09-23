/**
 * allowedUrlsSync.ts
 * Keeps the persisted ALLOWED_URLS allowlist in sync with the settings blob
 * (VULN-003 fix): buildAllowedUrls output is the single source, persisted to
 * chrome.storage on every settings change and seeded at SW startup so
 * existing users are migrated before the fail-closed reader lands.
 */

import { StorageKeys, type Settings } from '../utils/storage/types.js';
import { buildAllowedUrls, computeUrlsHash } from '../utils/storage/urlWhitelist.js';
import { settingsRepository } from '../utils/storage/SettingsRepository.js';
import { ErrorCode } from '../utils/logger/types.js';
import { logError, logWarn } from '../utils/logger/api.js';
import { errorMessage } from '../utils/errorUtils.js';

/**
 * Recompute the allowlist from the given settings and persist it together
 * with its change-detection hash. Idempotent and self-healing: running it on
 * every settings write (and at startup) repairs stale or missing entries.
 */
export async function syncAllowedUrlsFromSettings(settings: Settings): Promise<void> {
    const urls = buildAllowedUrls(settings);
    await chrome.storage.local.set({
        [StorageKeys.ALLOWED_URLS]: Array.from(urls),
        [StorageKeys.ALLOWED_URLS_HASH]: computeUrlsHash(urls),
    });
}

/**
 * Seed the allowlist from current settings and keep it in sync with every
 * subsequent settings write. The listener ignores changes that did not touch
 * the `settings` blob, so writing allowed_urls itself cannot recurse.
 */
export async function initAllowedUrlsSync(): Promise<void> {
    try {
        await syncAllowedUrlsFromSettings(await settingsRepository.getAll());
    } catch (error: unknown) {
        // The fail-closed reader rejects everything while the seed is missing,
        // so a failed seed must stay loud but never block SW startup.
        logError(
            'ALLOWED_URLS seed failed — FETCH_URL and provider allowlist stay fail-closed',
            { error: errorMessage(error instanceof Error ? error : new Error(String(error))) },
            ErrorCode.STORAGE_WRITE_FAILURE,
            'allowedUrlsSync',
        );
    }

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes['settings']) return;
        void (async () => {
            try {
                await syncAllowedUrlsFromSettings(await settingsRepository.getAll());
            } catch (error: unknown) {
                logWarn(
                    'ALLOWED_URLS re-sync failed',
                    { error: errorMessage(error instanceof Error ? error : new Error(String(error))) },
                    undefined,
                    'allowedUrlsSync',
                );
            }
        })();
    });
}
