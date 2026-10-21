import { StorageKeys } from './types.js';
import type { Settings, StorageKey } from './types.js';
import type { StoragePort } from './storagePort.js';
import { StorageTransaction } from './storageTransaction.js';

export const LEGACY_SETTINGS_BACKUP_KEY = 'legacy_settings_backup';

export const STORAGE_KEY_VALUES: ReadonlySet<string> = new Set<string>(Object.values(StorageKeys) as string[]);

export function isStorageKeyValue(key: string): key is StorageKey {
    return STORAGE_KEY_VALUES.has(key);
}

export function assignSettingValue(settings: Settings, key: StorageKey, value: unknown): void {
    const target = settings as Record<StorageKey, unknown>;
    target[key] = value;
}

// Prefix match on purpose: generations are stored as `${LEGACY_SETTINGS_BACKUP_KEY}_${createdAt}`.
export function listSettingsBackupKeys(all: Record<string, unknown>): string[] {
    return Object.keys(all).filter((k) => k.startsWith(LEGACY_SETTINGS_BACKUP_KEY));
}

// Numeric on the suffix (epoch ms), not lexicographic: `_9` must not outrank
// `_10`. Generations are stored as `${LEGACY_SETTINGS_BACKUP_KEY}_${createdAt}`;
// production suffixes are 13-digit epoch ms where both orders agree, so the
// selection is unchanged there, while mixed-length suffixes (test injection,
// future precision changes) pick the numerically latest generation (PBI
// 2026-10-21-05). A key without a numeric suffix (the bare legacy key, a
// corrupt entry) ranks oldest, so a real timestamped generation always wins;
// among equal generations (leading-zero variants, non-numeric suffixes) the
// lexicographically larger key wins, so the choice never depends on input
// order.
function backupKeyGeneration(key: string): number {
    const suffix = key.slice(LEGACY_SETTINGS_BACKUP_KEY.length + 1);
    return /^\d+$/.test(suffix) ? Number(suffix) : Number.NEGATIVE_INFINITY;
}

export function selectLatestSettingsBackupKey(keys: readonly string[]): string | null {
    let latest: string | null = null;
    let latestGeneration = Number.NEGATIVE_INFINITY;
    for (const key of keys) {
        const generation = backupKeyGeneration(key);
        if (
            latest === null ||
            generation > latestGeneration ||
            (generation === latestGeneration && key > latest)
        ) {
            latestGeneration = generation;
            latest = key;
        }
    }
    return latest;
}

export async function restoreLatestSettingsBackup(port: StoragePort): Promise<Settings | null> {
    const all = await port.get(null);
    const firstKey = selectLatestSettingsBackupKey(listSettingsBackupKeys(all));
    if (!firstKey) return null;
    const latest = all[firstKey] as { data: Record<string, unknown>; createdAt: number } | undefined;
    if (!latest?.data) return null;
    const restored: Settings = {};
    for (const [key, value] of Object.entries(latest.data)) {
        if (isStorageKeyValue(key)) assignSettingValue(restored, key, value);
    }
    if (Object.keys(restored).length > 0) {
        const tx = new StorageTransaction(port);
        // INTENTIONAL full-payload exception to the delta-write contract
        // (PBI 2026-10-18-12, Scenario 6): a backup restore replaces the
        // settings blob with the snapshot on purpose. The restore precondition
        // is an EMPTY blob plus an authoritative migration record, and it is
        // verified inside the lock: a write that landed between the caller's
        // empty read and this lock must not be reverted by the snapshot
        // spread, so a non-empty current blob wins and nothing is reported.
        let landed = true;
        await tx.withLock<Settings>('settings', (current) => {
            const base = current ?? ({} as Settings);
            if (Object.keys(base).length > 0) {
                landed = false;
                return base;
            }
            return restored;
        });
        if (!landed) return null;
    }
    return restored;
}
