import { describe, it, test, expect, vi, beforeEach } from 'vitest';
import type { Mocked } from 'vitest';
import { settingsRepository } from '../storage/SettingsRepository.js';
import { StorageKeys } from '../storage/types.js';
import * as migration from '../migration.js';

const mockedMigration = migration as Mocked<typeof migration>;

describe('getSettings key refinement', () => {
  beforeEach(() => {
    settingsRepository.clearCache();
    vi.restoreAllMocks();
  });

  test('fetches only StorageKeys', async () => {
    await chrome.storage.local.set({ extra_key: 'should_not', another_junk: 123 });
    settingsRepository.clearCache();

    const settings = await settingsRepository.getAll();

    expect(settings).not.toHaveProperty('extra_key');
    expect(settings).not.toHaveProperty('another_junk');
    // 暗号化用・ランタイムフラグ等の内部キーはgetSettings()の返却値に含まれない
    const internalKeys: Array<(typeof StorageKeys)[keyof typeof StorageKeys]> = [
      StorageKeys.IDB_MIGRATION_BACKUP,
      StorageKeys.ENCRYPTION_SALT,
      StorageKeys.ENCRYPTION_SECRET,
      StorageKeys.HMAC_SECRET,
      StorageKeys.MASTER_PASSWORD_ENABLED,
      StorageKeys.MASTER_PASSWORD_SALT,
      StorageKeys.MASTER_PASSWORD_HASH,
      StorageKeys.IS_LOCKED,
      StorageKeys.YASUMARO_MIGRATION_STATUS,
      StorageKeys.YASUMARO_MIGRATION_PROGRESS,
      StorageKeys.YASUMARO_MIGRATION_RETRY_COUNT,
      StorageKeys.MIGRATION_JP_LAYOUT_DEFAULT_DONE,
      StorageKeys.MIGRATION_CATEGORY_B_DEFAULT_DONE,
      StorageKeys.RECORDING_TRIGGERS,
      StorageKeys.SNAPSHOT_INTERVAL_MINUTES,
      StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS,
      StorageKeys.OPFS_FALLBACK_MODE,
      StorageKeys.MIGRATION_WHITELIST_EXTRACTION_DEFAULT_DONE,
      StorageKeys.ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID,
      StorageKeys.HISTORY_SORT_PREFERENCE,
      StorageKeys.TRUST_DB,
    ];
    Object.values(StorageKeys).forEach((key) => {
      if (!internalKeys.includes(key as (typeof StorageKeys)[keyof typeof StorageKeys])) {
        expect(settings).toHaveProperty(key as string);
      }
    });
  });

  test('returns only defaults for empty storage', async () => {
    const settings = await settingsRepository.getAll();

    expect(settings).toHaveProperty(StorageKeys.OBSIDIAN_PROTOCOL);
    expect(settings).toHaveProperty(StorageKeys.OBSIDIAN_PORT);
    expect(settings).not.toHaveProperty('extra_key');
  });

  test('retrieves saved values correctly', async () => {
    await chrome.storage.local.set({
      [StorageKeys.OBSIDIAN_API_KEY]: 'my-api-key',
      [StorageKeys.OBSIDIAN_PORT]: '8000'
    });
    settingsRepository.clearCache();

    const settings = await settingsRepository.getAll();

    expect(settings[StorageKeys.OBSIDIAN_API_KEY]).toBe('my-api-key');
    expect(settings[StorageKeys.OBSIDIAN_PORT]).toBe('8000');
    expect(settings).not.toHaveProperty('junk');
  });
});
