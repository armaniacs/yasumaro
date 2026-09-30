import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installTestSecretKek } from '../../crypto/__tests__/secretKekHelper.js';
import { InMemoryStoragePort } from '../storagePort.js';
import { InMemoryStorageAdapter, SettingsRepository } from '../SettingsRepository.js';
import { tryRestoreFromBackup, isMigratableStorageKey } from '../settingsMigration.js';
import { __resetStorageTransactionForTest } from '../storageTransaction.js';
import { StorageKeys } from '../types.js';

const PORT = StorageKeys.OBSIDIAN_PORT;
const HOST = StorageKeys.OBSIDIAN_HOST;

function backupEntry(data: Record<string, unknown>, createdAt: number): Record<string, unknown> {
  return { data, createdAt };
}

interface PathAResult {
  restored: Record<string, unknown> | null;
  blob: Record<string, unknown>;
}

async function runPathA(seedItems: Record<string, unknown>): Promise<PathAResult> {
  const port = new InMemoryStoragePort();
  port.seed(seedItems);
  const local = chrome.storage.local as unknown as Record<string, unknown>;
  const originalGet = local['get'];
  const originalSet = local['set'];
  local['get'] = (keys: string | string[] | null) => port.get(keys);
  local['set'] = (items: Record<string, unknown>) => port.set(items);
  try {
    const restored = (await tryRestoreFromBackup()) as unknown as Record<string, unknown> | null;
    const blob = ((await port.get('settings'))['settings'] ?? {}) as Record<string, unknown>;
    return { restored, blob };
  } finally {
    local['get'] = originalGet as never;
    local['set'] = originalSet as never;
  }
}

async function runPathBBlob(seedItems: Record<string, unknown>): Promise<Record<string, unknown>> {
  const adapter = new InMemoryStorageAdapter();
  adapter.seed(seedItems);
  const repo = new SettingsRepository(adapter);
  await repo.getAll();
  return ((await adapter.get('settings'))['settings'] ?? {}) as Record<string, unknown>;
}

describe('settings backup restore parity', () => {
  beforeEach(async () => {
    await installTestSecretKek();
    __resetStorageTransactionForTest();
  });

  afterEach(() => {
    __resetStorageTransactionForTest();
  });

  it('picks the newest generation on both paths', async () => {
    const seed = {
      settings: {},
      settings_migrated: true,
      legacy_settings_backup_1750000000000: backupEntry({ [PORT]: '1111', [HOST]: 'old-host' }, 1750000000000),
      legacy_settings_backup_1750000000001: backupEntry({ [PORT]: '2222' }, 1750000000001),
    };
    const a = await runPathA({ ...seed });
    const bBlob = await runPathBBlob({ ...seed });
    expect(a.restored).toEqual({ [PORT]: '2222' });
    expect(bBlob).toEqual({ [PORT]: '2222' });
    expect(a.restored).toEqual(bBlob);
  });

  it('drops unknown keys on both paths', async () => {
    const seed = {
      settings: {},
      settings_migrated: true,
      legacy_settings_backup_1750000000000: backupEntry({ [PORT]: '1111', not_a_storage_key: 'x' }, 1750000000000),
    };
    const a = await runPathA({ ...seed });
    const bBlob = await runPathBBlob({ ...seed });
    expect(a.restored).toEqual({ [PORT]: '1111' });
    expect(bBlob).toEqual({ [PORT]: '1111' });
    expect(a.restored).not.toHaveProperty('not_a_storage_key');
    expect(bBlob).not.toHaveProperty('not_a_storage_key');
  });

  it('keeps lexicographic generation order (_9 outranks _10)', async () => {
    const seed = {
      settings: {},
      settings_migrated: true,
      legacy_settings_backup_10: backupEntry({ [PORT]: 'ten' }, 10),
      legacy_settings_backup_9: backupEntry({ [PORT]: 'nine' }, 9),
    };
    const a = await runPathA({ ...seed });
    const bBlob = await runPathBBlob({ ...seed });
    expect(a.restored).toEqual({ [PORT]: 'nine' });
    expect(bBlob).toEqual({ [PORT]: 'nine' });
  });

  it('prefers a suffixed key over the bare key', async () => {
    const seed = {
      settings: {},
      settings_migrated: true,
      legacy_settings_backup: backupEntry({ [PORT]: 'bare' }, 1),
      legacy_settings_backup_1: backupEntry({ [PORT]: 'suffixed' }, 1),
    };
    const a = await runPathA({ ...seed });
    const bBlob = await runPathBBlob({ ...seed });
    expect(a.restored).toEqual({ [PORT]: 'suffixed' });
    expect(bBlob).toEqual({ [PORT]: 'suffixed' });
  });

  it('passes values through without conversion', async () => {
    const obj = { a: 1 };
    const seed = {
      settings: {},
      settings_migrated: true,
      legacy_settings_backup_1750000000000: backupEntry(
        { [PORT]: 'str', [HOST]: obj, [StorageKeys.MIN_VISIT_DURATION]: null },
        1750000000000,
      ),
    };
    const a = await runPathA({ ...seed });
    const bBlob = await runPathBBlob({ ...seed });
    expect(a.restored).toEqual({ [PORT]: 'str', [HOST]: { a: 1 }, [StorageKeys.MIN_VISIT_DURATION]: null });
    expect(bBlob).toEqual(a.restored);
  });

  it('merges into the existing blob (migration path only)', async () => {
    const seed = {
      settings: { [HOST]: 'keep', [PORT]: 'old' },
      legacy_settings_backup_1750000000000: backupEntry({ [PORT]: 'new-port' }, 1750000000000),
    };
    const a = await runPathA({ ...seed });
    expect(a.restored).toEqual({ [PORT]: 'new-port' });
    expect(a.blob).toEqual({ [HOST]: 'keep', [PORT]: 'new-port' });
  });

  it('returns null without a backup and leaves the blob empty', async () => {
    const seedNoBackup = { settings: {}, settings_migrated: true };
    const aNone = await runPathA({ ...seedNoBackup });
    expect(aNone.restored).toBeNull();
    const bNone = await runPathBBlob({ ...seedNoBackup });
    expect(bNone).toEqual({});

    const seedNoData = {
      settings: {},
      settings_migrated: true,
      legacy_settings_backup_1750000000000: { createdAt: 1750000000000 },
    };
    const aNoData = await runPathA({ ...seedNoData });
    expect(aNoData.restored).toBeNull();
    const bNoData = await runPathBBlob({ ...seedNoData });
    expect(bNoData).toEqual({});
  });

  it('leaves the blob untouched when only unknown keys are backed up', async () => {
    const seed = {
      settings: {},
      settings_migrated: true,
      legacy_settings_backup_1750000000000: backupEntry({ not_a_storage_key: 'x' }, 1750000000000),
    };
    const a = await runPathA({ ...seed });
    expect(a.restored).toEqual({});
    expect(a.blob).toEqual({});
    const bBlob = await runPathBBlob({ ...seed });
    expect(bBlob).toEqual({});
    expect(bBlob).toEqual(a.restored);
  });

  it('keeps the migratable-key predicate stable', async () => {
    expect(isMigratableStorageKey('legacy_settings_backup_1750000000000')).toBe(false);
    expect(isMigratableStorageKey(PORT)).toBe(true);
  });
});
