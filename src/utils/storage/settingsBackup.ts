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

// Lexicographic on the key string, not numeric: `_9` outranks `_10`. Kept as-is to preserve behavior.
export function selectLatestSettingsBackupKey(keys: readonly string[]): string | null {
    return [...keys].sort().reverse()[0] ?? null;
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
        await tx.withLock<Settings>('settings', (current) => ({ ...(current ?? {}), ...restored }));
    }
    return restored;
}
