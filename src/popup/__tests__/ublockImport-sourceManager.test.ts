/**
 * ublockImport-sourceManager.test.js
 * uBlock Import - SourceManagerモジュールのユニットテスト
 */

import { StorageKeys } from '../../utils/storage.js';
import {
  loadAndDisplaySources,
  deleteSource,
  reloadSource,
  saveUblockSettings
} from '../ublockImport/sourceManager.js';

// =============================================================================
// Test Utilities - Storage Mock Factory
// =============================================================================

/**
 * Create isolated storage mocks for testing.
 * Each call creates fresh mocks with their own enclosed storage state,
 * eliminating global mock override issues and ensuring test isolation.
 *
 * @returns {Object} An object containing:
 *   - getMock: Mock for chrome.storage.local.get
 *   - setMock: Mock for chrome.storage.local.set
 *   - getStorageState: Function to read current storage state
 *   - setStorageState: Function to set storage state directly
 *   - restoreOriginal: Function to restore original chrome.storage mocks
 */
function createStorageMocks() {
  // Encapsulated storage state - private to this factory instance
  let storage = {
    ublock_sources: [],
    ublock_rules: {},
    ublock_format_enabled: false
  };

  // Store original mocks to allow cleanup
  const originalGet = global.chrome.storage.local.get;
  const originalSet = global.chrome.storage.local.set;

  // Create fresh mock implementations
  const getMock = jest.fn((keys, callback) => {
    if (callback) callback({ ...storage });
    return Promise.resolve({ ...storage });
  });

  const setMock = jest.fn((data, callback) => {
    Object.assign(storage, data);
    if (callback) callback();
    return Promise.resolve();
  });

  // Helper functions for test control
  const getStorageState = () => ({ ...storage });
  const setStorageState = (newState) => { storage = { ...newState }; };

  // Replace global mocks
  global.chrome.storage.local.get = getMock;
  global.chrome.storage.local.set = setMock;

  return {
    getMock,
    setMock,
    getStorageState,
    setStorageState,
    restoreOriginal: () => {
      global.chrome.storage.local.get = originalGet;
      global.chrome.storage.local.set = originalSet;
    }
  };
}

// ============================================================================

describe('ublockImport - SourceManager Module', () => {
  let storageMocks;

  beforeEach(() => {
    // Create fresh isolated mocks for each test
    storageMocks = createStorageMocks();
  });

  afterEach(() => {
    // Restore original mocks after each test
    storageMocks.restoreOriginal();
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
        ublock_sources: [
          { url: 'https://example.com/filters1.txt', ruleCount: 2, blockDomains: ['example.com'], exceptionDomains: [] },
          { url: 'https://example.com/filters2.txt', ruleCount: 1, blockDomains: ['test.com'], exceptionDomains: [] }
        ],
        ublock_rules: {},
        ublock_format_enabled: false
      });

      const renderCallback = jest.fn();
      await deleteSource(0, renderCallback);

      expect(renderCallback).toHaveBeenCalled();

      const state = storageMocks.getStorageState();
      expect(state[StorageKeys.UBLOCK_SOURCES]).toHaveLength(1);
      expect(state[StorageKeys.UBLOCK_SOURCES][0].url).toBe('https://example.com/filters2.txt');
    });

    test('無効なインデックスでは何もしない', async () => {
      storageMocks.setStorageState({
        ublock_sources: [],
        ublock_rules: {},
        ublock_format_enabled: false
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
        ublock_sources: [
          { url: 'https://example.com/filters.txt', ruleCount: 2, blockDomains: ['example.com'], exceptionDomains: [] }
        ],
        ublock_rules: {},
        ublock_format_enabled: false
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
        ublock_sources: [],
        ublock_rules: {},
        ublock_format_enabled: false
      });

      const fetchFromUrlCallback = jest.fn();

      await expect(reloadSource(100, fetchFromUrlCallback)).rejects.toThrow('無効なインデックス');
    });

    test('手動入力のソースの再読み込みはエラー', async () => {
      storageMocks.setStorageState({
        ublock_sources: [
          { url: 'manual', ruleCount: 1, blockDomains: ['test.com'], exceptionDomains: [] }
        ],
        ublock_rules: {},
        ublock_format_enabled: false
      });

      const fetchFromUrlCallback = jest.fn();

      await expect(reloadSource(0, fetchFromUrlCallback)).rejects.toThrow('手動入力のソースは更新できません');
    });

    test('パースエラーがある場合はエラーを投げる', async () => {
      storageMocks.setStorageState({
        ublock_sources: [
          { url: 'https://example.com/filters.txt', ruleCount: 2, blockDomains: ['example.com'], exceptionDomains: [] }
        ],
        ublock_rules: {},
        ublock_format_enabled: false
      });

    // @ts-expect-error - jest.fn() type narrowing issue
  
      const fetchFromUrlCallback = jest.fn().mockResolvedValue('invalid line without caret');

      await expect(reloadSource(0, fetchFromUrlCallback)).rejects.toThrow('エラーが見つかりました');
    });

    test('パース結果にルールがない場合はエラーを投げる', async () => {
      storageMocks.setStorageState({
        ublock_sources: [
          { url: 'https://example.com/filters.txt', ruleCount: 2, blockDomains: ['example.com'], exceptionDomains: [] }
        ],
        ublock_rules: {},
        ublock_format_enabled: false
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
      expect(state1[StorageKeys.UBLOCK_SOURCES]).toHaveLength(1);

      // 同じURLで更新
      const updateResult = await saveUblockSettings('||updated.com^', url);

      expect(updateResult.action).toBe('更新');
      expect(updateResult.sources).toHaveLength(1);
      expect(updateResult.sources[0].url).toBe(url);

      const state2 = storageMocks.getStorageState();
      expect(state2[StorageKeys.UBLOCK_SOURCES]).toHaveLength(1);
    });

    test('手動入力を複数回保存しても1つのソースになる', async () => {
      // 最初の保存
      await saveUblockSettings('||example.com^');
      const state1 = storageMocks.getStorageState();
      expect(state1[StorageKeys.UBLOCK_SOURCES]).toHaveLength(1);

      // 同じURL（manual）で更新
      const updateResult = await saveUblockSettings('||updated.com^');

      expect(updateResult.action).toBe('更新');
      expect(updateResult.sources).toHaveLength(1);

      const state2 = storageMocks.getStorageState();
      expect(state2[StorageKeys.UBLOCK_SOURCES]).toHaveLength(1);
    });
  });
});