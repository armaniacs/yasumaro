/**
 * storage/settingsMigration.ts
 * Legacy migration and backup handling for settings.
 * Extracted from settingsStore.ts (PBI-01).
 */

import { logError, logWarn, ErrorCode } from '../logger.js';
import { errorMessage } from '../errorUtils.js';
import { migrateUblockSettings, migrateJpLayoutDefault, migrateCategoryBDefault, migrateWhitelistExtractionDefault } from '../migration.js';
import { isEncrypted, encryptApiKey, decryptApiKey } from '../crypto/index.js';
import { withOptimisticLock } from '../optimisticLock.js';
import { getOrCreateEncryptionKey } from './encryptionSession.js';
import { StorageKeys } from './types.js';
import { DEFAULT_SETTINGS } from './defaults.js';
import type { StorageKey, StorageKeyValues, Settings } from './types.js';

export const LEGACY_SETTINGS_BACKUP_KEY = 'legacy_settings_backup';
const BACKUP_RETENTION_DAYS = 30;
export const SETTINGS_MIGRATED_KEY = 'settings_migrated';

function isEncryptionKey(key: string): boolean {
    return key === StorageKeys.ENCRYPTION_SALT ||
        key === StorageKeys.ENCRYPTION_SECRET ||
        key === StorageKeys.HMAC_SECRET ||
        key === StorageKeys.MASTER_PASSWORD_SALT ||
        key === StorageKeys.MASTER_PASSWORD_HASH;
}

function assignSettingValue(settings: Settings, key: StorageKey, value: unknown): void {
    const target = settings as Record<StorageKey, unknown>;
    target[key] = value;
}

export async function migrateToSingleSettingsObject(): Promise<boolean> {
    const result = await chrome.storage.local.get(SETTINGS_MIGRATED_KEY);
    if (result[SETTINGS_MIGRATED_KEY]) {
        return false;
    }
    const existingKeys = await chrome.storage.local.get(null);
    const settings: Settings = {};
    for (const [key, value] of Object.entries(existingKeys)) {
        if (Object.values(StorageKeys).includes(key as StorageKey) &&
            !key.includes('_version') &&
            !isEncryptionKey(key) &&
            key !== SETTINGS_MIGRATED_KEY) {
            assignSettingValue(settings, key as StorageKey, value);
        }
    }
    if (Object.keys(settings).length === 0) {
        for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
            assignSettingValue(settings, key as StorageKey, value);
        }
    }
    await withOptimisticLock('settings', (currentSettings: Settings) => {
        return { ...currentSettings, ...settings };
    });
    await chrome.storage.local.set({ [SETTINGS_MIGRATED_KEY]: true });
    const keysToRemove = Object.keys(existingKeys).filter(key =>
        Object.values(StorageKeys).includes(key as StorageKey) &&
        !key.includes('_version') &&
        !isEncryptionKey(key) &&
        key !== SETTINGS_MIGRATED_KEY
    );
    if (keysToRemove.length > 0) {
        const backupData: Record<string, unknown> = {};
        for (const key of keysToRemove) {
            backupData[key] = existingKeys[key];
        }
        const backupKey = `${LEGACY_SETTINGS_BACKUP_KEY}_${Date.now()}`;
        await chrome.storage.local.set({
            [backupKey]: { data: backupData, createdAt: Date.now() },
        });
        await chrome.storage.local.remove(keysToRemove);
    }
    return true;
}

export const API_KEY_FIELDS: StorageKey[] = [
    StorageKeys.OBSIDIAN_API_KEY,
    StorageKeys.GEMINI_API_KEY,
    StorageKeys.OPENAI_API_KEY,
    StorageKeys.OPENAI_2_API_KEY,
    StorageKeys.PROVIDER_API_KEY,
    StorageKeys.GITHUB_PAT,
];

export async function applyMigrationsAndDecrypt(
    rawSettings: Settings,
    rawEncrypted: boolean = true
): Promise<Settings> {
    const merged = { ...DEFAULT_SETTINGS, ...rawSettings };
    if (!(StorageKeys.OBSIDIAN_ENABLED in rawSettings)) {
        const apiKey = merged[StorageKeys.OBSIDIAN_API_KEY] as string | undefined;
        merged[StorageKeys.OBSIDIAN_ENABLED] = !!(apiKey && apiKey.length >= 16);
    }
    if (!(StorageKeys.AI_PROVIDER_PRIORITY_LIST in rawSettings)) {
        const legacyProvider = merged[StorageKeys.AI_PROVIDER] as string | undefined;
        merged[StorageKeys.AI_PROVIDER_PRIORITY_LIST] = legacyProvider ? [{ provider: legacyProvider }] : [];
    }
    if (!(StorageKeys.LOCAL_MARKDOWN_EXPORT_TIMING in rawSettings)) {
        const legacyAutoEnabled = merged[StorageKeys.LOCAL_MARKDOWN_EXPORT_AUTO_ENABLED];
        merged[StorageKeys.LOCAL_MARKDOWN_EXPORT_TIMING] = legacyAutoEnabled ? 'idle' : 'manual';
    }
    if (rawEncrypted !== false) {
        try {
            const key = await getOrCreateEncryptionKey();
            for (const field of API_KEY_FIELDS) {
                const value = merged[field];
                if (isEncrypted(value)) {
                    try {
                        const decryptedValue = await decryptApiKey(value, key);
                        (merged as Record<StorageKey, StorageKeyValues[StorageKey]>)[field] = decryptedValue as StorageKeyValues[StorageKey];
                    } catch (e) {
                        await logError(`Failed to decrypt ${field}`, { error: errorMessage(e), field }, ErrorCode.CRYPTO_DECRYPTION_FAILURE);
                        (merged as Record<StorageKey, StorageKeyValues[StorageKey]>)[field] = '' as StorageKeyValues[StorageKey];
                    }
                } else if (typeof value === 'string' && value.length > 0) {
                    await logWarn(
                        `Plaintext API key detected: ${field}`,
                        { field },
                        undefined,
                        'settingsStore',
                    );
                    try {
                        const encrypted = await encryptApiKey(value, key);
                        (merged as Record<StorageKey, StorageKeyValues[StorageKey]>)[field] = value as StorageKeyValues[StorageKey];
                        const stored = await chrome.storage.local.get('settings');
                        const updated = { ...(stored.settings as Record<string, unknown> || {}), [field]: encrypted };
                        await chrome.storage.local.set({ settings: updated });
                    } catch (e) {
                        await logError(`Failed to re-encrypt plaintext ${field}`, { error: errorMessage(e), field }, ErrorCode.CRYPTO_ENCRYPTION_FAILURE);
                    }
                }
            }
        } catch (e) {
            await logError('Failed to get encryption key for decryption', { error: errorMessage(e) }, ErrorCode.CRYPTO_KEY_DERIVE_FAILURE);
        }
    }
    return merged;
}

export async function tryRestoreFromBackup(): Promise<Settings | null> {
    const all = await chrome.storage.local.get(null);
    const backupKeys = Object.keys(all).filter((k) => k.startsWith(LEGACY_SETTINGS_BACKUP_KEY));
    if (backupKeys.length === 0) return null;
    backupKeys.sort().reverse();
    const firstKey = backupKeys[0];
    if (!firstKey) return null;
    const latest = all[firstKey] as { data: Record<string, unknown>; createdAt: number } | undefined;
    if (!latest?.data) return null;
    const restored: Settings = {};
    for (const [key, value] of Object.entries(latest.data)) {
        if (Object.values(StorageKeys).includes(key as StorageKey)) {
            assignSettingValue(restored, key as StorageKey, value);
        }
    }
    await withOptimisticLock('settings', (current: Settings) => ({ ...current, ...restored }));
    return restored;
}

export async function cleanupExpiredSettingsBackups(): Promise<void> {
    const all = await chrome.storage.local.get(null);
    const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const expiredKeys = Object.keys(all).filter((k) => {
        if (!k.startsWith(LEGACY_SETTINGS_BACKUP_KEY)) return false;
        const entry = all[k] as { createdAt?: number } | undefined;
        return typeof entry?.createdAt === 'number' && entry.createdAt < cutoff;
    });
    if (expiredKeys.length > 0) {
        await chrome.storage.local.remove(expiredKeys);
    }
}
