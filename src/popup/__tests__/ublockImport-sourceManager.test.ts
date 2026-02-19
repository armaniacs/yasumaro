/**
 * ublockImport-sourceManager.test.js
 * uBlock Import - SourceManagerモジュールのユニットテスト
 */

import { StorageKeys, clearSettingsCache, getSettings } from '../../utils/storage.js';
import {
  loadAndDisplaySources,
  deleteSource,
  reloadSource,
  saveUblockSettings
} from '../ublockImport/sourceManager.js';
import { RecordingLogic } from '../../background/recordingLogic.js';

// 【重要】storage.tsのcachedSettingsを直接クリアするためのユーティリティ
// storage.tsのキャッシュは1秒間有効で、テスト間でリセットされない可能性がある
// テスト環境ではキャッシュを無効化する
const DISABLE_CACHE_IN_TESTS = async () => {
  // より直接的なアプローチ: clearSettingsCache後に待機して確実にクリアする
  clearSettingsCache();

  // RecordingLogicのstaticキャッシュもクリア
  RecordingLogic.invalidateSettingsCache();
  RecordingLogic.invalidateUrlCache();
};

// =============================================================================
// Test Utilities - Storage Mock Factory
// =============================================================================
function createStorageMocks() {
  // Initial state constant
  const INITIAL_STORAGE = {
    settings: {
      ublock_sources: [] as any[],
      ublock_rules: {} as Record<string, any>,
      ublock_format_enabled: false
    },
    settings_migrated: true,  // マイグレーション済みフラグ
    settings_version: 0       // バージョン番号
  };

  // Encapsulated storage state - private to this factory instance
  let storage = JSON.parse(JSON.stringify(INITIAL_STORAGE));

  // Store original module for cleanup (not inner mocks)
  const chromeStorageLocal = chrome.storage.local;

  // Create fresh mock implementations
  const getMock = jest.fn((keys: any, callback: any) => {
    const result = { ...storage };
    if (callback) callback(result);
    return Promise.resolve(result);
  });

  const setMock = jest.fn((data: any, callback: any) => {
    // 【重要】saveSettings はトップレベルに StorageKeys のキーを保存するが、
    // getSettings は settings オブジェクト内から読むため、トップレベルキーを
    // settings オブジェクト内にマージする必要がある
    const merged = { ...storage };

    // StorageKeysのキーの場合はsettingsオブジェクト内にマージ
    const storageKeyValues = Object.values(StorageKeys);
    for (const key of Object.keys(data)) {
      if (storageKeyValues.includes(key)) {
        // StorageKeysのキーであれば settings オブジェクト内に保存
        if (!merged.settings) {
          merged.settings = {};
        }
        merged.settings[key] = JSON.parse(JSON.stringify(data[key]));
      } else {
        // その他のキーはトップレベルに保存
        merged[key] = data[key];
      }
    }

    storage = JSON.parse(JSON.stringify(merged));

    // 【重要】storageが更新されたらキャッシュをクリア
    clearSettingsCache();

    if (callback) callback();
    return Promise.resolve();
  });

  const removeMock = jest.fn((keys: any, callback: any) => {
    if (callback) callback();
    return Promise.resolve();
  });

  // Helper functions for test control
  const getStorageState = () => JSON.parse(JSON.stringify(storage));
  const setStorageState = (newState: any) => {
    // 【重要】永続フラグを保持しながらマージする
    // 【重要】StorageKeysのキー（ublock_sources等）はsettingsオブジェクト内に保存する
    const storageKeyValues = Object.values(StorageKeys);
    const processedState: any = {};

    // 永続フラグとバージョン
    processedState.settings_migrated = true;
    processedState.settings_version = newState.settings_version || 0;

    // 処理済み状態
    let settings = { ...INITIAL_STORAGE.settings };

    // newStateの各キーを処理
    for (const key of Object.keys(newState)) {
      if (storageKeyValues.includes(key)) {
        // StorageKeysのキーであれば settings オブジェクト内に保存
        settings[key] = JSON.parse(JSON.stringify(newState[key]));
      } else if (key === 'settings') {
        // settings オブジェクトが渡された場合はマージ
        settings = JSON.parse(JSON.stringify({ ...settings, ...newState.settings }));
      } else {
        // フラグなどはトップレベルに保存
        processedState[key] = newState[key];
      }
    }

    processedState.settings = settings;
    storage = JSON.parse(JSON.stringify(processedState));
    clearSettingsCache();
  };

  const resetStorage = () => {
    storage = {
      settings: {
        ublock_sources: [] as any[],
        ublock_rules: {} as Record<string, any>,
        ublock_format_enabled: false
      },
      settings_migrated: true,
      settings_version: 0
    };
    // 【重要】storage stateをリセットしたらキャッシュをクリア
    clearSettingsCache();
  };

  // Replace global mocks
  chrome.storage.local = {
    get: getMock,
    set: setMock,
    remove: removeMock
  } as any;

  return {
    getMock,
    setMock,
    getStorageState,
    setStorageState,
    resetStorage,
    restoreOriginal: () => {
      chrome.storage.local = chromeStorageLocal;
    }
  };
}

// ============================================================================

describe('ublockImport - SourceManager Module', () => {
  let storageMocks: ReturnType<typeof createStorageMocks>;

  beforeEach(async () => {
    // 新しいモックを作成して各テストが完全に分離された状態を持つようにする
    storageMocks = createStorageMocks();

    // ストレージ状態を完全にリセット
    storageMocks.resetStorage();

    // console.logを抑制（一時的に解除して調査）- 削除
    // jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    // モックを復元
    storageMocks?.restoreOriginal?.();

    // 【重要】storage.tsのキャッシュをクリア（各テスト終了時）
    // storage.test.tsと同じパターン
    clearSettingsCache();
    RecordingLogic.invalidateSettingsCache();
    RecordingLogic.invalidateUrlCache();

    // jest.setup.js の localStorage をクリアして状態をリセット
    Object.keys(localStorage).forEach(key => delete localStorage[key]);
  });

  // ========================================================================
  // loadAndDisplaySources
  // ========================================================================

  describe('loadAndDisplaySources', () => {
    test('ソースを読み込んで表示コールバックを呼ぶ', async () => {
      const renderCallback = jest.fn();

      await loadAndDisplaySources(renderCallback);

      expect(renderCallback).toHaveBeenCalled();
    });

    test('renderCallbackがない場合は表示しない', async () => {
      await loadAndDisplaySources();
      // エラーを投げないことを確認
      expect(true).toBe(true);
    });
  });

  // ========================================================================
  // deleteSource
  // ========================================================================

  describe('deleteSource', () => {
    test('指定したインデックスのソースを削除', async () => {
      storageMocks.setStorageState({
        settings: {
          ublock_sources: [
            { url: 'https://example.com/filters1.txt', ruleCount: 2, blockDomains: ['example.com'], exceptionDomains: [] },
            { url: 'https://example.com/filters2.txt', ruleCount: 1, blockDomains: ['test.com'], exceptionDomains: [] }
          ],
          ublock_rules: {},
          ublock_format_enabled: false
        }
      });

      const renderCallback = jest.fn();
      await deleteSource(0, renderCallback);

      expect(renderCallback).toHaveBeenCalled();

      const state = storageMocks.getStorageState();
      expect(state.settings[StorageKeys.UBLOCK_SOURCES]).toHaveLength(1);
      expect(state.settings[StorageKeys.UBLOCK_SOURCES][0].url).toBe('https://example.com/filters2.txt');
    });

    test('無効なインデックスでは何もしない', async () => {
      storageMocks.setStorageState({
        settings: {
          ublock_sources: [],
          ublock_rules: {},
          ublock_format_enabled: false
        }
      });

      const renderCallback = jest.fn();
      await deleteSource(-1, renderCallback);

      expect(true).toBe(true); // 何も投げないことを確認
    });
  });

  // ========================================================================
  // reloadSource
  // ========================================================================

  describe('reloadSource', () => {
    test('ソースを再読み込みして更新', async () => {
      storageMocks.setStorageState({
        settings: {
          ublock_sources: [
            { url: 'https://example.com/filters.txt', ruleCount: 2, blockDomains: ['example.com'], exceptionDomains: [] }
          ],
          ublock_rules: {},
          ublock_format_enabled: false
        }
      });

    // @ts-expect-error - jest.fn() type narrowing issue
  
      const fetchFromUrlCallback = jest.fn().mockResolvedValue(`||example.com^\n||newdomain.com^`);

      const result = await reloadSource(0, fetchFromUrlCallback);

      expect(fetchFromUrlCallback).toHaveBeenCalledWith('https://example.com/filters.txt');
      expect(result.sources).toHaveLength(1);
      expect(result.ruleCount).toBeGreaterThan(0);
    });

    test('無効なインデックスではエラーを投げる', async () => {
      storageMocks.setStorageState({
        settings: {
          ublock_sources: [],
          ublock_rules: {},
          ublock_format_enabled: false
        }
      });

      const fetchFromUrlCallback = jest.fn();

      await expect(reloadSource(100, fetchFromUrlCallback)).rejects.toThrow('無効なインデックス');
    });

    test('手動入力のソースの再読み込みはエラー', async () => {
      storageMocks.setStorageState({
        settings: {
          ublock_sources: [
            { url: 'manual', ruleCount: 1, blockDomains: ['test.com'], exceptionDomains: [] }
          ],
          ublock_rules: {},
          ublock_format_enabled: false
        }
      });

      const fetchFromUrlCallback = jest.fn();

      await expect(reloadSource(0, fetchFromUrlCallback)).rejects.toThrow('手動入力のソースは更新できません');
    });

    test('パースエラーがある場合はエラーを投げる', async () => {
      storageMocks.setStorageState({
        settings: {
          ublock_sources: [
            { url: 'https://example.com/filters.txt', ruleCount: 2, blockDomains: ['example.com'], exceptionDomains: [] }
          ],
          ublock_rules: {},
          ublock_format_enabled: false
        }
      });

    // @ts-expect-error - jest.fn() type narrowing issue
  
      const fetchFromUrlCallback = jest.fn().mockResolvedValue('invalid line without caret');

      await expect(reloadSource(0, fetchFromUrlCallback)).rejects.toThrow('エラーが見つかりました');
    });

    test('パース結果にルールがない場合はエラーを投げる', async () => {
      storageMocks.setStorageState({
        settings: {
          ublock_sources: [
            { url: 'https://example.com/filters.txt', ruleCount: 2, blockDomains: ['example.com'], exceptionDomains: [] }
          ],
          ublock_rules: {},
          ublock_format_enabled: false
        }
      });

      // 空または無効なフィルターテキストを返す
    // @ts-expect-error - jest.fn() type narrowing issue
  
      const fetchFromUrlCallback = jest.fn().mockResolvedValue('');

      await expect(reloadSource(0, fetchFromUrlCallback)).rejects.toThrow('有効なルールが見つかりませんでした');
    });
  });

  // ========================================================================
  // saveUblockSettings
  // ========================================================================

  describe('saveUblockSettings', () => {
    test('有効なフィルターテキストを保存', async () => {
      const filterText = `||example.com^\n||test.com^`;

      const result = await saveUblockSettings(filterText);

      expect(result.action).toBe('追加');
      expect(result.ruleCount).toBe(2);
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].url).toBe('manual');
      expect(result.sources[0].blockDomains).toContain('example.com');
    });

    test('URL指定の場合はURLが保存される', async () => {
      const filterText = '||example.com^';
      const url = 'https://example.com/filters.txt';

      const result = await saveUblockSettings(filterText, url);

      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].url).toBe('https://example.com/filters.txt');
    });

    test('パースエラーがある場合はエラーを投げる', async () => {
      const filterText = 'invalid line without caret';

      await expect(saveUblockSettings(filterText)).rejects.toThrow(/エラーが見つかりました/);
    });

    test('有効なルールがない場合はエラーを投げる', async () => {
      // 空文字列は入力バリデーションで早期リターン
      const filterText = '';

      await expect(saveUblockSettings(filterText)).rejects.toThrow('有効なルールが見つかりませんでした');
    });

    test('パース後のルールが0の場合はエラーを投げる', async () => {
      // コメントのみのフィルターテキスト - 有効な文字列だがルールは0
      const filterText = '! This is a comment\n! Another comment';

      await expect(saveUblockSettings(filterText)).rejects.toThrow('有効なルールが見つかりませんでした');
    });

    test('大量のルールを正しく保存', async () => {
      const largeFilterText = Array(1000).fill(0).map((_, i) => `||domain${i}.com^`).join('\n');

      const result = await saveUblockSettings(largeFilterText);

      expect(result.ruleCount).toBe(1000);
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].url).toBe('manual');
    });

    test('既存のURLを指定した場合はソースを更新（追加しない）', async () => {
      const url = 'https://example.com/filters.txt';

      // 最初の保存
      await saveUblockSettings('||example.com^', url);
      const state1 = storageMocks.getStorageState();
      expect(state1.settings[StorageKeys.UBLOCK_SOURCES]).toHaveLength(1);

      // 同じURLで更新
      const updateResult = await saveUblockSettings('||updated.com^', url);

      expect(updateResult.action).toBe('更新');
      expect(updateResult.sources).toHaveLength(1);
      expect(updateResult.sources[0].url).toBe(url);

      const state2 = storageMocks.getStorageState();
      expect(state2.settings[StorageKeys.UBLOCK_SOURCES]).toHaveLength(1);
    });

    test('手動入力を複数回保存しても1つのソースになる', async () => {
      // 最初の保存
      await saveUblockSettings('||example.com^');
      const state1 = storageMocks.getStorageState();
      expect(state1.settings[StorageKeys.UBLOCK_SOURCES]).toHaveLength(1);

      // 同じURL（manual）で更新
      const updateResult = await saveUblockSettings('||updated.com^');

      expect(updateResult.action).toBe('更新');
      expect(updateResult.sources).toHaveLength(1);

      const state2 = storageMocks.getStorageState();
      expect(state2.settings[StorageKeys.UBLOCK_SOURCES]).toHaveLength(1);
    });
  });
});