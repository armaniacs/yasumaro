import { describe, it, test, expect, vi, beforeEach } from 'vitest';
import { getSettings, StorageKeys, saveSettings, clearSettingsCache } from '../storage.js';
import * as migration from '../migration.js';

const mockedMigration = migration as vi.Mocked<typeof migration>;

describe('getSettings key refinement', () => {
  beforeEach(() => {
    clearSettingsCache();
    vi.restoreAllMocks();
  });

  test('StorageKeysのみを取得する', async () => {
    await chrome.storage.local.set({ extra_key: 'should_not', another_junk: 123 });
    clearSettingsCache();

    const settings = await getSettings();

    expect(settings).not.toHaveProperty('extra_key');
    expect(settings).not.toHaveProperty('another_junk');
    // 暗号化用・ランタイムフラグ等の内部キーはgetSettings()の返却値に含まれない
    const internalKeys: StorageKeys[] = [
      StorageKeys.ENCRYPTION_SALT,
      StorageKeys.ENCRYPTION_SECRET,
      StorageKeys.HMAC_SECRET,
      StorageKeys.MASTER_PASSWORD_ENABLED,
      StorageKeys.MASTER_PASSWORD_SALT,
      StorageKeys.MASTER_PASSWORD_HASH,
      StorageKeys.IS_LOCKED,
      StorageKeys.YASUMARO_MIGRATION_STATUS,
      StorageKeys.YASUMARO_MIGRATION_PROGRESS,
      StorageKeys.RECORDING_TRIGGERS,
      StorageKeys.SNAPSHOT_INTERVAL_MINUTES,
      StorageKeys.OPFS_FALLBACK_MODE,
    ];
    Object.values(StorageKeys).forEach((key) => {
      if (!internalKeys.includes(key as StorageKeys)) {
        expect(settings).toHaveProperty(key as string);
      }
    });
  });

  test('空ストレージの場合はデフォルト値のみを返す', async () => {
    const settings = await getSettings();

    expect(settings).toHaveProperty(StorageKeys.OBSIDIAN_PROTOCOL);
    expect(settings).toHaveProperty(StorageKeys.OBSIDIAN_PORT);
    expect(settings).not.toHaveProperty('extra_key');
  });

  test('保存した値が正しく取得できる', async () => {
    await chrome.storage.local.set({
      [StorageKeys.OBSIDIAN_API_KEY]: 'my-api-key',
      [StorageKeys.OBSIDIAN_PORT]: '8000'
    });
    clearSettingsCache();

    const settings = await getSettings();

    expect(settings[StorageKeys.OBSIDIAN_API_KEY]).toBe('my-api-key');
    expect(settings[StorageKeys.OBSIDIAN_PORT]).toBe('8000');
    expect(settings).not.toHaveProperty('junk');
  });
});
