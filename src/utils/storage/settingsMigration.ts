/**
 * storage/settingsMigration.ts
 * Legacy migration and backup handling for settings.
 * Extracted from settingsStore.ts (PBI-01).
 */

import { ErrorCode } from '../logger/types.js';
import { logError, logWarn } from '../logger/api.js';
import { errorMessage } from '../errorUtils.js';
import { isEncrypted, encryptApiKey, decryptApiKey } from '../crypto/index.js';
import { withOptimisticLock } from './storageTransaction.js';
import { getOrCreateEncryptionKey } from './encryptionSession.js';
import { StorageKeys } from './types.js';
import { asStorageKeys } from './apiKeyFields.js';
import { DEFAULT_SETTINGS } from './defaults.js';
import {
    PROVIDER_ALLOWLIST_ROWS,
    isAllowedProviderBaseUrl,
    isLoopbackOriginHostname,
} from './providerAllowlist.js';
import type { StorageKey, StorageKeyValues, Settings } from './types.js';

export const LEGACY_SETTINGS_BACKUP_KEY = 'legacy_settings_backup';
const BACKUP_RETENTION_DAYS = 30;
export const SETTINGS_MIGRATED_KEY = 'settings_migrated';

/**
 * One-time gate for migrateLoopbackProviderOriginConfirmations (raw
 * chrome.storage.local key, outside the settings blob — same pattern as
 * SETTINGS_MIGRATED_KEY).
 */
const PROVIDER_LOOPBACK_GRANDFATHER_DONE_KEY = 'provider_loopback_origin_grandfather_done';

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

export const API_KEY_FIELDS: StorageKey[] = asStorageKeys();

/**
 * Legacy key derivation fallback for 29-12 migration.
 * 6.7.89 changed PBKDF2 from 100k to 600k. Existing encrypted API keys
 * with 100k-derived keys fail to decrypt with 600k. Try legacy 100k
 * for both anonymous (secret/salt) and master-password modes.
 */
import { deriveLegacyKeyFromStoredSecret } from '../crypto/kdfNegotiator.js';

async function tryDecryptWithLegacyFallback(
    encryptedValue: unknown,
    currentKey: CryptoKey,
): Promise<{ decrypted: string | null; legacySucceeded: boolean }> {
    try {
        const decrypted = await decryptApiKey(encryptedValue as never, currentKey);
        return { decrypted, legacySucceeded: false };
    } catch {
        // Try legacy 100k iteration fallback
        try {
            const stored = await chrome.storage.local.get([
                StorageKeys.MASTER_PASSWORD_ENABLED,
            ]);
            const isMasterEnabled = Boolean(stored[StorageKeys.MASTER_PASSWORD_ENABLED]);

            if (isMasterEnabled) {
                // Master-password mode: legacy fallback requires cached password which is not exposed.
                // verifyPasswordWithPBKDF2 already handles legacy iteration on unlock, so return failure
                // and let the next unlock migrate.
                return { decrypted: null, legacySucceeded: false };
            }

            // Anonymous mode: derive legacy 100k key from same secret/salt
            // PBI 2026-09-15-13: the hand-written PBKDF2 derive moved to
            // kdfNegotiator.deriveLegacyKeyFromStoredSecret.
            const legacyKey = await deriveLegacyKeyFromStoredSecret();
            if (!legacyKey) return { decrypted: null, legacySucceeded: false };
            const decrypted = await decryptApiKey(encryptedValue as never, legacyKey);
            return { decrypted, legacySucceeded: true };
        } catch {
            return { decrypted: null, legacySucceeded: false };
        }
    }
}

export interface ApplyMigrationsOptions {
  /** Key provider for decrypt/re-encrypt; defaults to getOrCreateEncryptionKey (chrome path) */
  getEncryptionKey?: () => Promise<CryptoKey>;
}

export interface ApplyMigrationsResult {
  settings: Settings;
  /** Fields that were plaintext and were re-encrypted — caller should persist via StoragePort */
  reEncrypted: Record<string, unknown>;
  /**
   * API-key fields whose stored ciphertext could not be decrypted with either
   * the current or the legacy key. The original ciphertext is preserved
   * untouched in `settings` (never blanked) so a later write cannot
   * permanently destroy it; callers should surface these fields via a
   * re-authentication prompt instead of treating them as empty.
   */
  unrecoverable: StorageKey[];
}

async function applyMigrationsCore(
    rawSettings: Settings,
    opts?: ApplyMigrationsOptions
): Promise<ApplyMigrationsResult> {
    // BackwardCompat: if opts is boolean (legacy rawEncrypted) treat as no-op
    if (typeof opts === 'boolean') opts = undefined as unknown as ApplyMigrationsOptions;
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
    const reEncrypted: Record<string, unknown> = {};
    const unrecoverable: StorageKey[] = [];
    try {
        const keyProvider = (opts as ApplyMigrationsOptions | undefined)?.getEncryptionKey ?? getOrCreateEncryptionKey;
        const key = await keyProvider();
        for (const field of API_KEY_FIELDS) {
            const value = merged[field];
            if (isEncrypted(value)) {
                const attempt = await tryDecryptWithLegacyFallback(value, key);
                if (attempt.decrypted !== null) {
                    (merged as Record<StorageKey, StorageKeyValues[StorageKey]>)[field] = attempt.decrypted as StorageKeyValues[StorageKey];
                    // If legacy fallback succeeded, re-encrypt with current key for migration
                    if (attempt.legacySucceeded) {
                        try {
                            const reEncryptedValue = await encryptApiKey(attempt.decrypted, key);
                            reEncrypted[field] = reEncryptedValue;
                            await logWarn(`Migrated ${field} from legacy 100k to 600k KDF`, { field }, undefined, 'settingsMigration');
                        } catch {}
                    }
                } else {
                    await logError(`Failed to decrypt ${field} (both current and legacy)`, { field }, ErrorCode.CRYPTO_DECRYPTION_FAILURE);
                    // Preserve the original ciphertext so a subsequent write
                    // cannot permanently destroy it; report via unrecoverable
                    // for a re-authentication prompt instead of blanking.
                    unrecoverable.push(field);
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
                    reEncrypted[field] = encrypted;
                } catch (e) {
                    await logError(`Failed to re-encrypt plaintext ${field}`, { error: errorMessage(e), field }, ErrorCode.CRYPTO_ENCRYPTION_FAILURE);
                }
            }
        }
    } catch (e) {
        await logError('Failed to get encryption key for decryption', { error: errorMessage(e) }, ErrorCode.CRYPTO_KEY_DERIVE_FAILURE);
    }
    return { settings: merged, reEncrypted, unrecoverable };
}

/**
 * Pure migration + decrypt. No direct chrome.storage writes.
 * Plaintext re-encryption is collected in `reEncrypted` for the caller (Settings.getAll)
 * to persist via StoragePort, keeping this function side-effect free.
 * Overload keeps legacy callers (returning Settings) working.
 */
export async function applyMigrationsAndDecrypt(
    rawSettings: Settings,
    opts?: ApplyMigrationsOptions | boolean
): Promise<Settings> {
    const core = await applyMigrationsCore(rawSettings, opts as ApplyMigrationsOptions);
    return core.settings;
}

export async function applyMigrationsAndDecryptWithReEncrypt(
    rawSettings: Settings,
    opts?: ApplyMigrationsOptions | boolean
): Promise<ApplyMigrationsResult> {
    return applyMigrationsCore(rawSettings, opts as ApplyMigrationsOptions);
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

/**
 * One-time grandfathering for the loopback tightening in
 * isProviderOriginAuthorized (loopback now auto-authorizes local-provider
 * slots only). Loopback URLs already stored in non-local slots — the
 * openai-compatible slot pointed at an Ollama/LM Studio endpoint was the
 * documented case — were authorized before the tightening and now fail
 * provider construction with "Base URL not authorized"; the confirmation
 * dialog cannot recover them because it skips unchanged URLs. This seeds
 * their origins into CONFIRMED_PROVIDER_ORIGINS exactly once, restoring
 * only the pre-tightening state. URLs set or changed afterwards still
 * require the dashboard confirmation, and settings imports keep stripping
 * confirmations. 127.x numeric loopback in non-local slots stays denied:
 * the deny layer blocked it before this change too, so there is nothing to
 * grandfather.
 */
export async function migrateLoopbackProviderOriginConfirmations(): Promise<boolean> {
    const done = await chrome.storage.local.get(PROVIDER_LOOPBACK_GRANDFATHER_DONE_KEY);
    if (done[PROVIDER_LOOPBACK_GRANDFATHER_DONE_KEY]) {
        return false;
    }

    let seeded = 0;
    await withOptimisticLock<Settings>('settings', (current) => {
        const confirmedMap: Record<string, string[]> = {
            ...((current[StorageKeys.CONFIRMED_PROVIDER_ORIGINS] as Record<string, string[]> | undefined) ?? {}),
        };
        for (const row of PROVIDER_ALLOWLIST_ROWS) {
            if (row.isLocal || !row.baseUrlKey) continue;
            const stored = (current[row.baseUrlKey] as string | undefined)
                ?? ((DEFAULT_SETTINGS as Record<string, unknown>)[row.baseUrlKey] as string | undefined);
            if (typeof stored !== 'string' || stored === '') continue;
            let parsed: URL;
            try {
                parsed = new URL(stored);
            } catch {
                continue;
            }
            if (!isLoopbackOriginHostname(parsed.hostname.toLowerCase().replace(/\.+$/, ''))) continue;
            // Origins the deny layer rejects stay rejected with or without a
            // confirmation — seeding them would be a no-op entry at best.
            if (!isAllowedProviderBaseUrl(stored, row.isLocal)) continue;
            const existing = confirmedMap[row.baseUrlKey] ?? [];
            if (existing.includes(parsed.origin)) continue;
            confirmedMap[row.baseUrlKey] = [...existing, parsed.origin];
            seeded++;
        }
        if (seeded === 0) return current;
        return {
            ...current,
            [StorageKeys.CONFIRMED_PROVIDER_ORIGINS]: confirmedMap,
        };
    });

    await chrome.storage.local.set({ [PROVIDER_LOOPBACK_GRANDFATHER_DONE_KEY]: true });
    return seeded > 0;
}
