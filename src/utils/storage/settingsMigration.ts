/**
 * storage/settingsMigration.ts
 * Legacy migration and backup handling for settings.
 * Extracted from settingsStore.ts (PBI-01).
 */

import { ErrorCode } from '../logger/types.js';
import { logError, logWarn } from '../logger/api.js';
import { errorMessage } from '../errorUtils.js';
import { isEncrypted, encryptApiKey, decryptApiKey } from '../crypto/index.js';
import { withOptimisticLock, StorageTransaction, deepEqual } from './storageTransaction.js';
import { getOrCreateEncryptionKey } from './encryptionSession.js';
import { StorageKeys } from './types.js';
import { asStorageKeys } from './apiKeyFields.js';
import { DEFAULT_SETTINGS } from './defaults.js';
import { ChromeStoragePort, type StoragePort } from './storagePort.js';
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
 * Explicit migration schema version. Version 1 is the unversioned boolean
 * contract: it recorded completion *before* the backup existed, so a Service
 * Worker torn down between the nested-settings write and the legacy-key removal
 * left the flag set with neither a backup nor the raw keys — the migration could
 * never run again and the settings were lost. Version 2 records the stage the
 * run reached and records completion last, so an interrupted run always leaves
 * "not completed" behind and is retried on the next start.
 */
export const SETTINGS_MIGRATION_SCHEMA_VERSION = 2;

export type SettingsMigrationStage = 'pending' | 'backed_up' | 'legacy_removed' | 'completed';

export interface SettingsMigrationState {
    schemaVersion: number;
    stage: SettingsMigrationStage;
}

/** Ordered so a resumed run can never move the recorded stage backwards. */
const MIGRATION_STAGE_ORDER: readonly SettingsMigrationStage[] = [
    'pending',
    'backed_up',
    'legacy_removed',
    'completed',
];

/** Re-reads before removal can race with a concurrent writer this many times. */
const MAX_REMOVE_ATTEMPTS = 3;

/**
 * One-time gate for migrateLoopbackProviderOriginConfirmations (raw
 * chrome.storage.local key, outside the settings blob — same pattern as
 * SETTINGS_MIGRATED_KEY).
 */
const PROVIDER_LOOPBACK_GRANDFATHER_DONE_KEY = 'provider_loopback_origin_grandfather_done';

function isSettingsMigrationStage(value: unknown): value is SettingsMigrationStage {
    return typeof value === 'string' && (MIGRATION_STAGE_ORDER as readonly string[]).includes(value);
}

/**
 * Parse whatever `settings_migrated` holds. A bare stage string is accepted as
 * schema version 1 (an unversioned stage record cannot be trusted as complete).
 * Anything else — the legacy boolean, `false`, a corrupt object — is unverified
 * and left for the repair path.
 */
export function parseSettingsMigrationState(raw: unknown): SettingsMigrationState | null {
    if (isSettingsMigrationStage(raw)) {
        return { schemaVersion: 1, stage: raw };
    }
    if (raw !== null && typeof raw === 'object') {
        const record = raw as { schemaVersion?: unknown; stage?: unknown };
        if (typeof record.schemaVersion === 'number' && isSettingsMigrationStage(record.stage)) {
            return { schemaVersion: record.schemaVersion, stage: record.stage };
        }
    }
    return null;
}

/**
 * Completion, as the migration entry sees it.
 *
 * The legacy boolean `true` counts as complete. It is the record every install
 * that predates this schema has, and re-running the migration for those installs
 * is not safe: it relocates keys into the `settings` blob and deletes the raw
 * copy, while a number of owning modules (`privacyConsent.ts`,
 * `recordingTriggerManager.ts`, `urlWhitelist.ts`, the offscreen migration
 * state, …) still read their key straight from `chrome.storage.local` and have
 * no blob-side reader. Re-running therefore silently drops that state — the
 * privacy consent modal comes back, recording triggers reset, and so on.
 *
 * A *partial* stage record is truthy and would pass a truthiness check, which is
 * exactly the bug the stage machine replaces: those still resume, because the
 * stage names the step to continue from.
 *
 * Auditing which keys may be relocated at all is PBI 2026-09-25-18.
 */
export function isSettingsMigrationComplete(raw: unknown): boolean {
    if (raw === true) return true;
    const state = parseSettingsMigrationState(raw);
    return state !== null && state.stage === 'completed' && state.schemaVersion >= SETTINGS_MIGRATION_SCHEMA_VERSION;
}

/**
 * Read-path predicate: is the `settings` blob the authoritative source?
 *
 * Same answer as the migration entry, and deliberately so. When the two
 * disagreed — blob trusted for reads while the migration still re-ran — the
 * migration's view won in practice, and any key it relocated became invisible
 * to the module that owned it.
 */
export function isSettingsBlobAuthoritative(raw: unknown): boolean {
    return isSettingsMigrationComplete(raw);
}

const STORAGE_KEY_VALUES: ReadonlySet<string> = new Set<string>(Object.values(StorageKeys) as string[]);

/**
 * Keys that stay at the top level of `chrome.storage.local` even though they are
 * ordinary `StorageKeys` values. This is an explicit allowlist on purpose: the
 * previous `!key.includes('_version')` substring test also matched
 * `gemini_api_version` (a user setting the dashboard must be able to change)
 * while matching nothing about the CAS records it was meant to exclude.
 *
 * Each entry is a key whose owning module reads or writes it directly through
 * `chrome.storage.local`, so migrating it into the `settings` blob deletes the
 * only copy the owner can see.
 */
const TOP_LEVEL_ONLY_KEYS: ReadonlySet<string> = new Set<string>([
    // Keyring: re-encrypting or relocating these would strand the ciphertext.
    StorageKeys.ENCRYPTION_SALT,
    StorageKeys.ENCRYPTION_SECRET,
    StorageKeys.HMAC_SECRET,
    StorageKeys.MASTER_PASSWORD_SALT,
    StorageKeys.MASTER_PASSWORD_HASH,
    // Version-managed state read straight from storage (privacyConsent.ts,
    // trancoConsentManager.ts). Moving them into the blob would reset the
    // consent / Tranco UI state the user already acknowledged.
    StorageKeys.PRIVACY_CONSENT_VERSION,
    StorageKeys.TRANCO_VERSION,
    // Device-local trust database owned by TrustDbKernel, which persists it
    // with its own withOptimisticLock on the raw key and has no blob-side reader.
    StorageKeys.TRUST_DB,
]);

/**
 * A key migrates into the `settings` blob only when it is a `StorageKeys` value
 * and not on the top-level allowlist. CAS records (`settings_version`,
 * `savedUrls_version`, …), the `settings` blob itself, `settings_migrated`, the
 * `legacy_settings_backup_*` family and every other module's keys are all
 * rejected by the membership test, so no name-pattern guess is involved.
 */
export function isMigratableStorageKey(key: string): boolean {
    if (!STORAGE_KEY_VALUES.has(key)) return false;
    return !TOP_LEVEL_ONLY_KEYS.has(key);
}

function assignSettingValue(settings: Settings, key: StorageKey, value: unknown): void {
    const target = settings as Record<StorageKey, unknown>;
    target[key] = value;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(record, key);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export interface MigrateSettingsOptions {
    /** Storage seam; defaults to `chrome.storage.local`. */
    port?: StoragePort;
    /** Clock seam for the backup key suffix; defaults to `Date.now`. */
    now?: () => number;
}

/**
 * Merge `delta` into the `settings` blob.
 *
 * `overwriteExisting === false` is the resume/repair rule: a key the blob
 * already holds is newer than the raw copy (the blob is the only writer after
 * migration started), so only the gaps are filled. The conflict path passes
 * `true` because there the raw value was observed changing *after* the backup,
 * which makes it the newest copy.
 */
async function mergeIntoNestedSettings(
    tx: StorageTransaction,
    delta: Settings,
    overwriteExisting: boolean,
): Promise<void> {
    const entries = Object.entries(delta as Record<string, unknown>);
    if (entries.length === 0) return;
    await tx.withLock<Settings>('settings', (current) => {
        const base = isPlainRecord(current) ? current : {};
        const next: Record<string, unknown> = { ...base };
        for (const [key, value] of entries) {
            if (overwriteExisting || next[key] === undefined) next[key] = value;
        }
        return next as Settings;
    });
}

async function recordStage(
    port: StoragePort,
    stage: SettingsMigrationStage,
    currentIndex: number,
): Promise<number> {
    const nextIndex = MIGRATION_STAGE_ORDER.indexOf(stage);
    if (nextIndex <= currentIndex) return currentIndex;
    await port.set({
        [SETTINGS_MIGRATED_KEY]: {
            schemaVersion: SETTINGS_MIGRATION_SCHEMA_VERSION,
            stage,
        } satisfies SettingsMigrationState,
    });
    return nextIndex;
}

/**
 * Write the backup and read it back. `tryRestoreFromBackup()` is only useful
 * with a backup that is actually in storage, so the write is verified before
 * any legacy key is removed.
 */
async function writeAndVerifyBackup(
    port: StoragePort,
    values: Record<string, unknown>,
    now: () => number,
): Promise<void> {
    const createdAt = now();
    const backupKey = `${LEGACY_SETTINGS_BACKUP_KEY}_${createdAt}`;
    await port.set({ [backupKey]: { data: values, createdAt } });
    const stored = (await port.get(backupKey))[backupKey];
    if (!isPlainRecord(stored) || !isPlainRecord(stored['data'])) {
        throw new Error(`Settings backup ${backupKey} could not be verified`);
    }
    for (const [key, value] of Object.entries(values)) {
        if (!deepEqual(stored['data'][key], value)) {
            throw new Error(`Settings backup ${backupKey} lost key ${key}`);
        }
    }
}

/**
 * A backup already covers `keys` when a `legacy_settings_backup_*` entry exists
 * whose `data` holds every one of them — the same shape
 * `tryRestoreFromBackup()` recognises. Reusing it keeps a resumed run from
 * stacking duplicate backups after repeated interruptions.
 */
async function hasCoveringBackup(port: StoragePort, keys: readonly string[]): Promise<boolean> {
    if (keys.length === 0) return true;
    const all = await port.get(null);
    const backupKeys = Object.keys(all).filter((k) => k.startsWith(LEGACY_SETTINGS_BACKUP_KEY));
    for (const backupKey of backupKeys) {
        const entry = all[backupKey];
        if (!isPlainRecord(entry) || !isPlainRecord(entry['data'])) continue;
        if (keys.every((k) => hasOwn(entry['data'] as Record<string, unknown>, k))) return true;
    }
    return false;
}

export async function migrateToSingleSettingsObject(
    options: MigrateSettingsOptions = {},
): Promise<boolean> {
    const port = options.port ?? new ChromeStoragePort();
    const now = options.now ?? (() => Date.now());
    const tx = new StorageTransaction(port);
    const remove = (keys: string[]): Promise<void> =>
        port.remove
            ? port.remove(keys)
            : chrome.storage.local.remove(keys);

    const rawState = (await port.get(SETTINGS_MIGRATED_KEY))[SETTINGS_MIGRATED_KEY];
    if (isSettingsMigrationComplete(rawState)) return false;

    // Unverified legacy records (boolean true/false, absent, corrupt) restart at
    // `pending`; a partial stage resumes from the stage it recorded.
    const parsedState = parseSettingsMigrationState(rawState);
    let stageIndex = parsedState ? MIGRATION_STAGE_ORDER.indexOf(parsedState.stage) : -1;

    const all = await port.get(null);
    const legacyKeys = Object.keys(all).filter(
        (key) => isMigratableStorageKey(key) && hasOwn(all, key),
    );
    const nested = all['settings'];
    const hasNestedSettings = isPlainRecord(nested) && Object.keys(nested).length > 0;

    const collected: Settings = {};
    for (const key of legacyKeys) assignSettingValue(collected, key as StorageKey, all[key]);
    if (Object.keys(collected).length === 0 && !hasNestedSettings) {
        for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
            assignSettingValue(collected, key as StorageKey, value);
        }
    }

    stageIndex = await recordStage(port, 'pending', stageIndex);
    await mergeIntoNestedSettings(tx, collected, false);

    for (let attempt = 0; attempt < MAX_REMOVE_ATTEMPTS; attempt++) {
        const snapshot = await port.get(null);
        const remaining = legacyKeys.filter((key) => hasOwn(snapshot, key));
        if (remaining.length === 0) break;

        if (await hasCoveringBackup(port, remaining)) {
            stageIndex = await recordStage(port, 'backed_up', stageIndex);
        } else {
            const backupData: Record<string, unknown> = {};
            for (const key of remaining) backupData[key] = snapshot[key];
            await writeAndVerifyBackup(port, backupData, now);
            stageIndex = await recordStage(port, 'backed_up', stageIndex);
        }

        // Re-read immediately before the destructive step. A raw key that
        // changed after the backup — or a concurrent writer that moved the
        // nested blob's CAS generation — would be deleted together with the only
        // copy of the new value, so follow the latest values and start over.
        // A key that disappeared instead is simply no longer ours to remove.
        const preRemove = await port.get(null);
        const stillPresent = remaining.filter((key) => hasOwn(preRemove, key));
        const changed = stillPresent.filter((key) => !deepEqual(preRemove[key], snapshot[key]));
        const generationDrift = (preRemove['settings_version'] ?? 0) !== (snapshot['settings_version'] ?? 0);
        if (changed.length > 0 || generationDrift) {
            const latest: Settings = {};
            for (const key of changed) assignSettingValue(latest, key as StorageKey, preRemove[key]);
            await mergeIntoNestedSettings(tx, latest, true);
            const refreshed: Record<string, unknown> = {};
            for (const key of stillPresent) refreshed[key] = preRemove[key];
            await writeAndVerifyBackup(port, refreshed, now);
            continue;
        }

        await remove(stillPresent);
        stageIndex = await recordStage(port, 'legacy_removed', stageIndex);
    }

    // Completion is recorded last, and only once nothing migratable is left.
    // Any earlier failure propagates with the state still short of `completed`,
    // which is what makes the next start retry instead of trusting the record.
    const finalAll = await port.get(null);
    if (legacyKeys.some((key) => hasOwn(finalAll, key))) return false;
    await recordStage(port, 'completed', stageIndex);
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
