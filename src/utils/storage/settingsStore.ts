/**
 * storage/settingsStore.ts
 * Settings CRUD, cache, and encryption orchestration.
 * Slimmed from 685 lines (PBI-01): whitelist / migration / maintenance extracted.
 */

import { logInfo, logDebug, logError, ErrorCode } from '../logger.js';
import { errorMessage } from '../errorUtils.js';
import { migrateUblockSettings, migrateJpLayoutDefault, migrateCategoryBDefault, migrateWhitelistExtractionDefault } from '../migration.js';
import { encryptApiKey } from '../crypto/index.js';
import { withOptimisticLock } from '../optimisticLock.js';
import { getOrCreateEncryptionKey } from './encryptionSession.js';
import { StorageKeys } from './types.js';
import type { StorageKey, StorageKeyValues, Settings } from './types.js';
import { applyMigrationsAndDecrypt, tryRestoreFromBackup, API_KEY_FIELDS } from './settingsMigration.js';
import { buildAllowedUrls, computeUrlsHash } from './urlWhitelist.js';
import { ensureStorageQuota } from './storageMaintenance.js';

export { purgeLegacyStorage } from './savedUrlStore.js';
export { API_KEY_FIELDS } from './settingsMigration.js';
export { ALLOWED_AI_PROVIDER_DOMAINS, isDomainInWhitelist, buildAllowedUrls, computeUrlsHash, getAllowedUrls } from './urlWhitelist.js';
export { LEGACY_SETTINGS_BACKUP_KEY, migrateToSingleSettingsObject, cleanupExpiredSettingsBackups } from './settingsMigration.js';
export { getDefaultSqliteHealthCheck } from './storageMaintenance.js';

let cachedSettings: { data: Settings | null; timestamp: number } | null = null;
const SETTINGS_CACHE_TTL = 1000;

export async function getSettings(): Promise<Settings> {
    const now = Date.now();
    if (cachedSettings && cachedSettings.data && (now - cachedSettings.timestamp) < SETTINGS_CACHE_TTL) {
        return cachedSettings.data;
    }
    const result = await chrome.storage.local.get(['settings', 'settings_migrated']);
    const rawSettings = result.settings as Settings | undefined;
    await logInfo('[Storage] Raw storage result:', {
        hasSettings: !!rawSettings,
        hasKeys: rawSettings ? Object.keys(rawSettings).some(k => k.toLowerCase().includes('key')) : false
    });
    if (result.settings && result['settings_migrated']) {
        let settings = result.settings as Settings;
        if (Object.keys(settings).length === 0) {
            const recovered = await tryRestoreFromBackup();
            if (recovered) {
                settings = recovered;
            }
        }
        const validStorageKeys: string[] = Object.values(StorageKeys);
        const filteredSettings: Settings = {};
        for (const [key, value] of Object.entries(settings)) {
            if (validStorageKeys.includes(key)) {
                (filteredSettings as Record<string, unknown>)[key] = value;
            }
        }
        const merged = await applyMigrationsAndDecrypt(filteredSettings);
        cachedSettings = { data: merged, timestamp: Date.now() };
        return merged;
    }
    const keysToGet: string[] = Object.values(StorageKeys);
    let settings = await chrome.storage.local.get(keysToGet);
    if (rawSettings) {
        settings = { ...settings, ...rawSettings };
    }
    const migrated = await migrateUblockSettings();
    if (migrated) {
        const afterMigration = await chrome.storage.local.get(keysToGet);
        settings = { ...settings, ...afterMigration };
    }
    await migrateJpLayoutDefault();
    await migrateCategoryBDefault();
    await migrateWhitelistExtractionDefault();
    try {
        const { getTrustDb } = await import('../trustDb/trustDb.js');
        const db = getTrustDb();
        await db.initialize();
    } catch (e) {
        logDebug('storage', { error: e }, 'Failed to initialize Tranco version');
    }
    const merged = await applyMigrationsAndDecrypt(settings as Settings);
    cachedSettings = { data: merged, timestamp: Date.now() };
    return merged;
}

export function clearSettingsCache(): void {
    cachedSettings = null;
}

export async function saveSettings(
    settings: Settings,
    updateAllowedUrlsFlag: boolean = false,
    sqliteHealthCheck?: () => Promise<boolean>
): Promise<void> {
    cachedSettings = null;
    let toSave = { ...settings };
    try {
        const key = await getOrCreateEncryptionKey();
        for (const field of API_KEY_FIELDS) {
            if (field in toSave && typeof toSave[field] === 'string' && toSave[field] !== '') {
                const originalValue = toSave[field] as string;
                (toSave as Record<StorageKey, StorageKeyValues[StorageKey]>)[field] = await encryptApiKey(originalValue, key) as StorageKeyValues[StorageKey];
                await logDebug(`Encrypted ${field}:`, {
                    hadValue: !!originalValue,
                    originalLength: originalValue.length,
                    encrypted: !!toSave[field]
                });
            }
        }
    } catch (e) {
        await logError('Failed to encrypt API keys', { error: errorMessage(e) }, ErrorCode.CRYPTO_ENCRYPTION_FAILURE);
        throw e;
    }
    if (updateAllowedUrlsFlag) {
        const currentSettings = await getSettings();
        const mergedSettings = { ...currentSettings, ...toSave };
        const allowedUrls = buildAllowedUrls(mergedSettings);
        const allowedUrlsHash = computeUrlsHash(allowedUrls);
        toSave = {
            ...toSave,
            [StorageKeys.ALLOWED_URLS]: Array.from(allowedUrls),
            [StorageKeys.ALLOWED_URLS_HASH]: allowedUrlsHash
        };
    }
    await ensureStorageQuota(toSave as Record<string, unknown>, sqliteHealthCheck);
    await withOptimisticLock('settings', (currentSettings: Settings) => {
        return { ...currentSettings, ...toSave };
    });
    cachedSettings = null;
}

export async function saveSettingsWithAllowedUrls(settings: Settings): Promise<void> {
    await saveSettings(settings, true);
    const { updateDomainFilterCache } = await import('./domainFilterCache.js');
    await updateDomainFilterCache(settings);
}
