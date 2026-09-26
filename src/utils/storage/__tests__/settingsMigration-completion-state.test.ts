/**
 * settingsMigration-completion-state.test.ts
 *
 * PBI 2026-09-25-17: the settings migration is a resumable sequence of storage
 * writes, not one atomic operation. A Service Worker can be torn down between any
 * two of them, so this suite injects a failure (or a concurrent writer) at every
 * boundary and pins the two properties that prevent data loss:
 *
 *   1. `settings_migrated` never reads as complete while a migratable raw key or
 *      an unverified backup is still outstanding.
 *   2. The next start finishes the migration from wherever the previous one died.
 *
 * The harness drives the real `chrome.storage.local` seam (the global mock from
 * vitest.setup) so the default `ChromeStoragePort`, `withOptimisticLock` and
 * `tryRestoreFromBackup()` all observe the same store the migration does.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryStoragePort } from '../storagePort.js';
import { SettingsRepository } from '../SettingsRepository.js';
import { DEFAULT_SETTINGS } from '../defaults.js';
import {
    LEGACY_SETTINGS_BACKUP_KEY,
    SETTINGS_MIGRATED_KEY,
    SETTINGS_MIGRATION_SCHEMA_VERSION,
    isMigratableStorageKey,
    isSettingsBlobAuthoritative,
    isSettingsMigrationComplete,
    migrateToSingleSettingsObject,
    parseSettingsMigrationState,
    tryRestoreFromBackup,
    type SettingsMigrationStage,
    type SettingsMigrationState,
} from '../settingsMigration.js';
import { StorageKeys } from '../types.js';

const RAW_PORT = '27123';
const RAW_KEYS = 'plain-key-1234567890';

interface Faults {
    failBackupWrite?: boolean;
    failRemove?: boolean;
    /** Runs right after each successful backup write (concurrent-writer injection). */
    afterBackupWrite?: (writeIndex: number) => void;
    /** Runs after each full-store scan, modelling a writer that never stops racing. */
    afterFullScan?: () => void;
}

interface Harness {
    data: Record<string, unknown>;
    journal: string[];
    faults: Faults;
    backupWrites: number;
}

function isBackupKey(key: string): boolean {
    return key.startsWith(LEGACY_SETTINGS_BACKUP_KEY);
}

function createHarness(): Harness {
    const harness: Harness = { data: {}, journal: [], faults: {}, backupWrites: 0 };
    const local = chrome.storage.local as unknown as {
        get: (keys: string | string[] | null) => Promise<Record<string, unknown>>;
        set: (items: Record<string, unknown>) => Promise<void>;
        remove: (keys: string | string[]) => Promise<void>;
    };

    local.get = (keys) => {
        const finish = (result: Record<string, unknown>): Promise<Record<string, unknown>> => {
            if (keys === null) harness.faults.afterFullScan?.();
            return Promise.resolve(result);
        };
        if (keys === null) return finish({ ...harness.data });
        if (Array.isArray(keys)) {
            const out: Record<string, unknown> = {};
            for (const key of keys) {
                if (key in harness.data) out[key] = harness.data[key];
            }
            return Promise.resolve(out);
        }
        return Promise.resolve(keys in harness.data ? { [keys]: harness.data[keys] } : {});
    };

    local.set = async (items) => {
        for (const key of Object.keys(items)) harness.journal.push(`set:${key}`);
        const backupEntries = Object.keys(items).filter(isBackupKey);
        if (backupEntries.length > 0 && harness.faults.failBackupWrite) {
            throw new Error('quota exceeded');
        }
        Object.assign(harness.data, items);
        if (backupEntries.length > 0) {
            harness.backupWrites++;
            harness.faults.afterBackupWrite?.(harness.backupWrites);
        }
    };

    local.remove = async (keys) => {
        const list = Array.isArray(keys) ? keys : [keys];
        if (harness.faults.failRemove) throw new Error('service worker terminated');
        for (const key of list) {
            harness.journal.push(`remove:${key}`);
            delete harness.data[key];
        }
    };

    return harness;
}

let harness: Harness;

beforeEach(() => {
    harness = createHarness();
});

function stateOf(): SettingsMigrationState | true | false | undefined {
    return harness.data[SETTINGS_MIGRATED_KEY] as SettingsMigrationState | true | false | undefined;
}

function stageOf(): string | undefined {
    const state = stateOf();
    return typeof state === 'object' && state !== null ? state.stage : undefined;
}

function blob(): Record<string, unknown> {
    return (harness.data['settings'] ?? {}) as Record<string, unknown>;
}

function backupEntries(): Array<{ key: string; data: Record<string, unknown> }> {
    return Object.entries(harness.data)
        .filter(([key]) => isBackupKey(key))
        .map(([key, value]) => ({ key, data: (value as { data: Record<string, unknown> }).data }));
}

function indexOfJournal(match: string): number {
    return harness.journal.findIndex((entry) => entry.startsWith(match));
}

function legacyStorage(): Record<string, unknown> {
    return {
        [StorageKeys.OBSIDIAN_API_KEY]: RAW_KEYS,
        [StorageKeys.OBSIDIAN_PORT]: RAW_PORT,
        [StorageKeys.GEMINI_API_VERSION]: 'v1',
        [StorageKeys.TRANCO_VERSION]: '2026-09-01T00:00:00Z',
        [StorageKeys.PRIVACY_CONSENT_VERSION]: '2026-08-01',
        [StorageKeys.TRUST_DB]: { version: 1, entries: [] },
        [StorageKeys.ENCRYPTION_SALT]: 'salt-value',
        settings_version: 3,
    };
}

describe('settings migration — completion is an explicit versioned stage', () => {
    it('accepts only a versioned completed record', () => {
        expect(isSettingsMigrationComplete({ schemaVersion: 2, stage: 'completed' })).toBe(true);
        expect(isSettingsMigrationComplete({ schemaVersion: 3, stage: 'completed' })).toBe(true);
    });

    it.each<SettingsMigrationStage>(['pending', 'backed_up', 'legacy_removed'])(
        'rejects the truthy stage %s',
        (stage) => {
            expect(isSettingsMigrationComplete({ schemaVersion: 2, stage })).toBe(false);
            expect(isSettingsMigrationComplete(stage)).toBe(false);
        },
    );

    it('rejects a completed record written by an older schema version', () => {
        expect(isSettingsMigrationComplete({ schemaVersion: 1, stage: 'completed' })).toBe(false);
    });

    it('treats the legacy boolean as complete so installed profiles are not re-migrated', () => {
        // The legacy boolean is what every install that predates this schema
        // carries. Re-running for them relocates keys whose owning modules still
        // read them raw, which silently drops that state — the privacy consent
        // modal comes back, recording triggers reset, and so on. The migration
        // entry and the read path therefore have to agree.
        expect(isSettingsMigrationComplete(true)).toBe(true);
        expect(isSettingsBlobAuthoritative(true)).toBe(true);

        expect(isSettingsMigrationComplete(false)).toBe(false);
        expect(isSettingsMigrationComplete(undefined)).toBe(false);
        expect(isSettingsMigrationComplete('done')).toBe(false);
        expect(isSettingsMigrationComplete({ stage: 'completed' })).toBe(false);
        expect(isSettingsMigrationComplete(1)).toBe(false);

        // A partial stage still resumes: the stage names the step to continue.
        expect(isSettingsMigrationComplete({ schemaVersion: 2, stage: 'pending' })).toBe(false);
        expect(isSettingsBlobAuthoritative({ schemaVersion: 2, stage: 'completed' })).toBe(true);
        expect(isSettingsBlobAuthoritative({ schemaVersion: 2, stage: 'pending' })).toBe(false);
        expect(isSettingsBlobAuthoritative({ schemaVersion: 2, stage: 'backed_up' })).toBe(false);
        expect(isSettingsBlobAuthoritative({ schemaVersion: 2, stage: 'legacy_removed' })).toBe(false);
        expect(isSettingsBlobAuthoritative(false)).toBe(false);
        expect(isSettingsBlobAuthoritative(undefined)).toBe(false);
    });

    it('parses a bare stage string as the unversioned legacy record', () => {
        expect(parseSettingsMigrationState('backed_up')).toEqual({ schemaVersion: 1, stage: 'backed_up' });
        expect(parseSettingsMigrationState(true)).toBeNull();
    });
});

describe('settings migration — key classification is by stored value, not by name', () => {
    it('migrates gemini_api_version, whose name only looks like a version record', () => {
        expect(isMigratableStorageKey(StorageKeys.GEMINI_API_VERSION)).toBe(true);
    });

    it('keeps version-managed state at the top level', () => {
        expect(isMigratableStorageKey(StorageKeys.TRANCO_VERSION)).toBe(false);
        expect(isMigratableStorageKey(StorageKeys.PRIVACY_CONSENT_VERSION)).toBe(false);
    });

    it('keeps the keyring and the device-local trust database at the top level', () => {
        expect(isMigratableStorageKey(StorageKeys.ENCRYPTION_SALT)).toBe(false);
        expect(isMigratableStorageKey(StorageKeys.ENCRYPTION_SECRET)).toBe(false);
        expect(isMigratableStorageKey(StorageKeys.HMAC_SECRET)).toBe(false);
        expect(isMigratableStorageKey(StorageKeys.MASTER_PASSWORD_SALT)).toBe(false);
        expect(isMigratableStorageKey(StorageKeys.MASTER_PASSWORD_HASH)).toBe(false);
        expect(isMigratableStorageKey(StorageKeys.TRUST_DB)).toBe(false);
    });

    it('never treats a CAS record, the blob, the state key or a backup as migratable', () => {
        for (const key of [
            'settings',
            'settings_version',
            'settings_migrated',
            'savedUrls_version',
            'legacy_settings_backup_1750000000000',
            'provider_loopback_origin_grandfather_done',
            'some_other_module_key',
        ]) {
            expect(isMigratableStorageKey(key)).toBe(false);
        }
    });

    it('migrates ordinary settings that merely live next to the version records', () => {
        expect(isMigratableStorageKey(StorageKeys.OBSIDIAN_PORT)).toBe(true);
        expect(isMigratableStorageKey(StorageKeys.RECORDING_TRIGGERS)).toBe(true);
    });
});

describe('settings migration — happy path', () => {
    it('moves raw settings into the blob, backs them up, removes them, then records completion', async () => {
        harness.data = legacyStorage();

        await expect(migrateToSingleSettingsObject()).resolves.toBe(true);

        expect(blob()[StorageKeys.OBSIDIAN_PORT]).toBe(RAW_PORT);
        expect(blob()[StorageKeys.OBSIDIAN_API_KEY]).toBe(RAW_KEYS);
        expect(blob()[StorageKeys.GEMINI_API_VERSION]).toBe('v1');
        expect(harness.data[StorageKeys.OBSIDIAN_PORT]).toBeUndefined();
        expect(stateOf()).toEqual({
            schemaVersion: SETTINGS_MIGRATION_SCHEMA_VERSION,
            stage: 'completed',
        });
    });

    it('leaves the top-level-only keys untouched and writes a backup the restore path recognises', async () => {
        harness.data = legacyStorage();

        await migrateToSingleSettingsObject();

        expect(harness.data[StorageKeys.TRANCO_VERSION]).toBe('2026-09-01T00:00:00Z');
        expect(harness.data[StorageKeys.PRIVACY_CONSENT_VERSION]).toBe('2026-08-01');
        expect(harness.data[StorageKeys.TRUST_DB]).toEqual({ version: 1, entries: [] });
        expect(harness.data[StorageKeys.ENCRYPTION_SALT]).toBe('salt-value');
        // The CAS record is never migrated as a setting; only the blob merge moves it.
        expect(harness.data['settings_version']).toBe(4);

        const backups = backupEntries();
        expect(backups).toHaveLength(1);
        expect(backups[0]!.data[StorageKeys.OBSIDIAN_PORT]).toBe(RAW_PORT);

        // The written backup is consumable by tryRestoreFromBackup(): wiping the
        // blob and restoring brings the migrated values back.
        harness.data['settings'] = {};
        await expect(tryRestoreFromBackup()).resolves.toMatchObject({
            [StorageKeys.OBSIDIAN_PORT]: RAW_PORT,
            [StorageKeys.OBSIDIAN_API_KEY]: RAW_KEYS,
        });
    });

    it('records completion strictly after the backup write and the legacy-key removal', async () => {
        harness.data = legacyStorage();

        await migrateToSingleSettingsObject();

        const backupAt = indexOfJournal(`set:${LEGACY_SETTINGS_BACKUP_KEY}`);
        const removeAt = indexOfJournal(`remove:${StorageKeys.OBSIDIAN_PORT}`);
        const completeAt = harness.journal.lastIndexOf(`set:${SETTINGS_MIGRATED_KEY}`);
        expect(backupAt).toBeGreaterThanOrEqual(0);
        expect(removeAt).toBeGreaterThan(backupAt);
        expect(completeAt).toBeGreaterThan(removeAt);
    });

    it('skips a completed migration without touching anything', async () => {
        harness.data = {
            ...legacyStorage(),
            settings: { [StorageKeys.OBSIDIAN_PORT]: '99999' },
            [SETTINGS_MIGRATED_KEY]: {
                schemaVersion: SETTINGS_MIGRATION_SCHEMA_VERSION,
                stage: 'completed',
            },
        };

        await expect(migrateToSingleSettingsObject()).resolves.toBe(false);
        expect(blob()[StorageKeys.OBSIDIAN_PORT]).toBe('99999');
        expect(harness.journal).toEqual([]);
    });

    it('seeds the defaults for a profile with nothing stored at all', async () => {
        await expect(migrateToSingleSettingsObject()).resolves.toBe(true);
        expect(blob()[StorageKeys.OBSIDIAN_PROTOCOL]).toBe('https');
        expect(stageOf()).toBe('completed');
    });

    it('does not overwrite keys the blob already holds when filling the gaps', async () => {
        harness.data = { ...legacyStorage(), settings: { [StorageKeys.OBSIDIAN_PORT]: 'newer-value' } };

        await migrateToSingleSettingsObject();

        expect(blob()[StorageKeys.OBSIDIAN_PORT]).toBe('newer-value');
        expect(blob()[StorageKeys.GEMINI_API_VERSION]).toBe('v1');
    });
});

describe('settings migration — interruption at every storage boundary', () => {
    it('never records completion when the backup write fails, and finishes on the next run', async () => {
        harness.data = legacyStorage();
        harness.faults.failBackupWrite = true;

        await expect(migrateToSingleSettingsObject()).rejects.toThrow('quota exceeded');
        expect(stageOf()).toBe('pending');
        expect(isSettingsMigrationComplete(stateOf())).toBe(false);
        // The raw keys survive, and the blob already holds a copy of them.
        expect(harness.data[StorageKeys.OBSIDIAN_PORT]).toBe(RAW_PORT);
        expect(blob()[StorageKeys.OBSIDIAN_PORT]).toBe(RAW_PORT);

        harness.faults.failBackupWrite = false;
        await expect(migrateToSingleSettingsObject()).resolves.toBe(true);
        expect(stageOf()).toBe('completed');
        expect(harness.data[StorageKeys.OBSIDIAN_PORT]).toBeUndefined();
        expect(backupEntries()).toHaveLength(1);
    });

    it('stops at backed_up when the removal fails, and finishes on the next run', async () => {
        harness.data = legacyStorage();
        harness.faults.failRemove = true;

        await expect(migrateToSingleSettingsObject()).rejects.toThrow('service worker terminated');
        expect(stageOf()).toBe('backed_up');
        expect(backupEntries()).toHaveLength(1);
        expect(harness.data[StorageKeys.OBSIDIAN_PORT]).toBe(RAW_PORT);

        harness.faults.failRemove = false;
        await expect(migrateToSingleSettingsObject()).resolves.toBe(true);
        expect(stageOf()).toBe('completed');
        expect(harness.data[StorageKeys.OBSIDIAN_PORT]).toBeUndefined();
        // The resume reuses the verified backup instead of stacking a new one.
        expect(backupEntries()).toHaveLength(1);
    });

    it('resumes a partially removed legacy set without overwriting the blob', async () => {
        harness.data = {
            [StorageKeys.OBSIDIAN_HOST]: 'stored.example',
            settings: { [StorageKeys.OBSIDIAN_PORT]: 'blob-wins' },
            [SETTINGS_MIGRATED_KEY]: {
                schemaVersion: SETTINGS_MIGRATION_SCHEMA_VERSION,
                stage: 'backed_up',
            },
            [`${LEGACY_SETTINGS_BACKUP_KEY}_1000`]: {
                data: { [StorageKeys.OBSIDIAN_PORT]: RAW_PORT, [StorageKeys.OBSIDIAN_HOST]: 'stored.example' },
                createdAt: 1000,
            },
        };

        await expect(migrateToSingleSettingsObject()).resolves.toBe(true);

        expect(harness.data[StorageKeys.OBSIDIAN_HOST]).toBeUndefined();
        expect(blob()[StorageKeys.OBSIDIAN_PORT]).toBe('blob-wins');
        expect(blob()[StorageKeys.OBSIDIAN_HOST]).toBe('stored.example');
        expect(stageOf()).toBe('completed');
    });

    it('completes a legacy_removed run by recording the stage only', async () => {
        harness.data = {
            settings: { [StorageKeys.OBSIDIAN_PORT]: RAW_PORT },
            settings_version: 7,
            [SETTINGS_MIGRATED_KEY]: {
                schemaVersion: SETTINGS_MIGRATION_SCHEMA_VERSION,
                stage: 'legacy_removed',
            },
            [`${LEGACY_SETTINGS_BACKUP_KEY}_1000`]: {
                data: { [StorageKeys.OBSIDIAN_PORT]: RAW_PORT },
                createdAt: 1000,
            },
        };

        await expect(migrateToSingleSettingsObject()).resolves.toBe(true);

        expect(blob()[StorageKeys.OBSIDIAN_PORT]).toBe(RAW_PORT);
        expect(harness.data['settings_version']).toBe(7);
        expect(backupEntries()).toHaveLength(1);
        expect(stageOf()).toBe('completed');
    });

    it('follows a raw key that changed between the backup and the removal', async () => {
        harness.data = legacyStorage();
        harness.faults.afterBackupWrite = (writeIndex) => {
            harness.data[StorageKeys.OBSIDIAN_PORT] = 'concurrent-value';
            void writeIndex;
        };

        await expect(migrateToSingleSettingsObject()).resolves.toBe(true);

        expect(harness.data[StorageKeys.OBSIDIAN_PORT]).toBeUndefined();
        expect(blob()[StorageKeys.OBSIDIAN_PORT]).toBe('concurrent-value');
        expect(stageOf()).toBe('completed');
        // The refreshed backup, not the stale one, is the newest restore source.
        expect(backupEntries().at(-1)!.data[StorageKeys.OBSIDIAN_PORT]).toBe('concurrent-value');
    });

    it('gives up without recording completion when the raw key keeps changing', async () => {
        harness.data = legacyStorage();
        let churn = 0;
        harness.faults.afterFullScan = () => {
            churn++;
            harness.data[StorageKeys.OBSIDIAN_PORT] = `churn-${churn}`;
        };

        await expect(migrateToSingleSettingsObject()).resolves.toBe(false);
        expect(stageOf()).toBe('backed_up');
        expect(isSettingsMigrationComplete(stateOf())).toBe(false);
        // The raw key survives (so the next start retries) and the blob already
        // carries a value newer than the one that was originally read.
        expect(harness.data[StorageKeys.OBSIDIAN_PORT]).toBeDefined();
        expect(blob()[StorageKeys.OBSIDIAN_PORT]).toBeDefined();
        expect(blob()[StorageKeys.OBSIDIAN_PORT]).not.toBe(RAW_PORT);
    });
});

describe('settings migration — repairing the legacy boolean record', () => {
    it('leaves a legacy boolean profile untouched — no backfill, no raw removal', async () => {
        // Regression pin. Treating the legacy boolean as "not complete" made
        // every existing install re-run the migration, which relocated raw-owned
        // keys and deleted the only copy their owner could read. The privacy
        // consent modal reappeared and recording triggers reset.
        harness.data = {
            settings: { [StorageKeys.OBSIDIAN_PORT]: 'blob-value' },
            settings_version: 4,
            [SETTINGS_MIGRATED_KEY]: true,
            [StorageKeys.OBSIDIAN_PORT]: 'stale-raw-value',
            [StorageKeys.OBSIDIAN_HOST]: 'only-in-raw',
        };

        await expect(migrateToSingleSettingsObject()).resolves.toBe(false);

        // Nothing moved, nothing deleted, and the record keeps its old shape so
        // a later release can still decide what to do with it.
        expect(blob()[StorageKeys.OBSIDIAN_PORT]).toBe('blob-value');
        expect(harness.data[StorageKeys.OBSIDIAN_HOST]).toBe('only-in-raw');
        expect(harness.data[StorageKeys.OBSIDIAN_PORT]).toBe('stale-raw-value');
        expect(harness.data[SETTINGS_MIGRATED_KEY]).toBe(true);
        expect(backupEntries()).toHaveLength(0);
    });

    it('still backfills the gaps when a partial stage says the run was unfinished', async () => {
        // The stage machine is what makes a resumed run safe, so the backfill
        // behaviour is kept and pinned against a partial record.
        harness.data = {
            settings: { [StorageKeys.OBSIDIAN_PORT]: 'blob-value' },
            settings_version: 4,
            [SETTINGS_MIGRATED_KEY]: { schemaVersion: SETTINGS_MIGRATION_SCHEMA_VERSION, stage: 'backed_up' },
            [StorageKeys.OBSIDIAN_PORT]: 'stale-raw-value',
            [StorageKeys.OBSIDIAN_HOST]: 'only-in-raw',
        };

        await expect(migrateToSingleSettingsObject()).resolves.toBe(true);

        expect(blob()[StorageKeys.OBSIDIAN_PORT]).toBe('blob-value');
        expect(blob()[StorageKeys.OBSIDIAN_HOST]).toBe('only-in-raw');
        expect(harness.data[StorageKeys.OBSIDIAN_PORT]).toBeUndefined();
        expect(stateOf()).toEqual({
            schemaVersion: SETTINGS_MIGRATION_SCHEMA_VERSION,
            stage: 'completed',
        });
    });

    it('completes a partial stage with nothing left to migrate without creating a backup', async () => {
        harness.data = {
            settings: { [StorageKeys.OBSIDIAN_PORT]: RAW_PORT },
            [SETTINGS_MIGRATED_KEY]: { schemaVersion: SETTINGS_MIGRATION_SCHEMA_VERSION, stage: 'legacy_removed' },
        };

        await expect(migrateToSingleSettingsObject()).resolves.toBe(true);
        expect(backupEntries()).toHaveLength(0);
        expect(stageOf()).toBe('completed');
    });

    it('does not seed the defaults over an existing blob', async () => {
        harness.data = {
            settings: { [StorageKeys.OBSIDIAN_PORT]: RAW_PORT },
            [SETTINGS_MIGRATED_KEY]: true,
        };

        await migrateToSingleSettingsObject();

        expect(Object.keys(blob())).toEqual([StorageKeys.OBSIDIAN_PORT]);
    });
});

describe('SettingsRepository — an unfinished stage is not an authoritative blob', () => {
    function readWith(state: unknown): Promise<Record<string, unknown>> {
        const adapter = new InMemoryStoragePort();
        adapter.seed({
            settings: { [StorageKeys.OBSIDIAN_PORT]: RAW_PORT },
            [SETTINGS_MIGRATED_KEY]: state as never,
            [StorageKeys.OBSIDIAN_HOST]: 'only-in-raw',
        });
        return new SettingsRepository(adapter).getAll() as Promise<Record<string, unknown>>;
    }

    it.each([{ schemaVersion: 2, stage: 'pending' }, { schemaVersion: 2, stage: 'backed_up' }, { schemaVersion: 2, stage: 'legacy_removed' }])(
        'folds raw keys in while the stage is $stage',
        async (state) => {
            const all = await readWith(state);
            expect(all[StorageKeys.OBSIDIAN_PORT]).toBe(RAW_PORT);
            expect(all[StorageKeys.OBSIDIAN_HOST]).toBe('only-in-raw');
        },
    );

    it('reads the blob alone once the stage is completed', async () => {
        const adapter = new InMemoryStoragePort();
        adapter.seed({
            settings: { [StorageKeys.OBSIDIAN_PORT]: RAW_PORT },
            [SETTINGS_MIGRATED_KEY]: {
                schemaVersion: SETTINGS_MIGRATION_SCHEMA_VERSION,
                stage: 'completed',
            },
            [StorageKeys.OBSIDIAN_HOST]: 'only-in-raw',
        });
        const all = (await new SettingsRepository(adapter).getAll()) as Record<string, unknown>;
        // The raw copy is ignored once the blob is authoritative, so the host
        // resolves from the defaults rather than from the leftover raw key.
        expect(all[StorageKeys.OBSIDIAN_HOST]).toBe(DEFAULT_SETTINGS[StorageKeys.OBSIDIAN_HOST]);
        expect(all[StorageKeys.OBSIDIAN_PORT]).toBe(RAW_PORT);
    });
});
