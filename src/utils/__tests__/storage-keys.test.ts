import { getSettings, StorageKeys, saveSettings, clearSettingsCache } from '../storage.js';
import * as migration from '../migration.js';

// Mock migration module
jest.mock('../migration', () => ({
  migrateUblockSettings: jest.fn(() => Promise.resolve(false))
}));

const mockedMigration = migration as jest.Mocked<typeof migration>;

describe('getSettings key refinement', () => {
  beforeEach(() => {
    // 各テスト前にキャッシュをクリア
    clearSettingsCache();
  });

  test('StorageKeysのみを取得する', async () => {
    // 不相応なデータをセット
    await chrome.storage.local.set({ extra_key: 'should_not', another_junk: 123 });
    clearSettingsCache(); // storage直接更新後にキャッシュクリア

    const settings = await getSettings();

    expect(settings).not.toHaveProperty('extra_key');
    expect(settings).not.toHaveProperty('another_junk');
    // 暗号化用と楽観的ロック用の内部キーはgetSettings()の返却値に含まれない
    const internalKeys: StorageKeys[] = [
      StorageKeys.ENCRYPTION_SALT,
      StorageKeys.ENCRYPTION_SECRET,
      StorageKeys.SAVED_URLS_VERSION,
      StorageKeys.HMAC_SECRET,
      StorageKeys.MASTER_PASSWORD_ENABLED,
      StorageKeys.MASTER_PASSWORD_SALT,
      StorageKeys.MASTER_PASSWORD_HASH,
      StorageKeys.IS_LOCKED
    ];
    Object.values(StorageKeys).forEach((key) => {
      if (!internalKeys.includes(key as StorageKeys)) {
        expect(settings).toHaveProperty(key as string);
      }
    });
  });

  test('空ストレージの場合はデフォルト値のみを返す', async () => {
    const settings = await getSettings();

    // デフォルト値が含まれることを確認
    expect(settings).toHaveProperty(StorageKeys.OBSIDIAN_PROTOCOL);
    expect(settings).toHaveProperty(StorageKeys.OBSIDIAN_PORT);
    expect(settings).not.toHaveProperty('extra_key');
  });

  test('保存した値が正しく取得できる', async () => {
    // 設定を保存
    await chrome.storage.local.set({
      [StorageKeys.OBSIDIAN_API_KEY]: 'my-api-key',
      [StorageKeys.OBSIDIAN_PORT]: '8000'
    });
    clearSettingsCache(); // storage直接更新後にキャッシュクリア

    // getSettingsを呼ぶ
    const settings = await getSettings();

    expect(settings[StorageKeys.OBSIDIAN_API_KEY]).toBe('my-api-key');
    expect(settings[StorageKeys.OBSIDIAN_PORT]).toBe('8000');
    expect(settings).not.toHaveProperty('junk');
  });
});