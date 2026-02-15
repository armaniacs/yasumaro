import { getSettings, StorageKeys, saveSettings } from '../storage.ts';
import * as migration from '../migration.ts';

jest.mock('../migration.ts', () => ({
  migrateUblockSettings: jest.fn(() => Promise.resolve(false))
}));

describe('getSettings key refinement', () => {
  test('StorageKeysのみを取得する', async () => {
    // 不相応なデータをセット
    await chrome.storage.local.set({ extra_key: 'should_not', another_junk: 123 });

    const settings = await getSettings();

    expect(settings).not.toHaveProperty('extra_key');
    expect(settings).not.toHaveProperty('another_junk');
    // 暗号化用と楽観的ロック用の内部キーはgetSettings()の返却値に含まれない
    const internalKeys = [
      StorageKeys.ENCRYPTION_SALT,
      StorageKeys.ENCRYPTION_SECRET,
      StorageKeys.SAVED_URLS_VERSION,
      StorageKeys.HMAC_SECRET
    ];
    Object.values(StorageKeys).forEach(key => {
      if (!internalKeys.includes(key)) {
        expect(settings).toHaveProperty(key);
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

    // getSettingsを呼ぶ
    const settings = await getSettings();

    expect(settings[StorageKeys.OBSIDIAN_API_KEY]).toBe('my-api-key');
    expect(settings[StorageKeys.OBSIDIAN_PORT]).toBe('8000');
    expect(settings).not.toHaveProperty('junk');
  });
});
