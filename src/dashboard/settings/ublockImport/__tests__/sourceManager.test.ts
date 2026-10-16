/**
 * ublockImport-sourceManager.test.js
 * uBlock Import - SourceManagerモジュールのユニットテスト
 *
 * @vitest-environment jsdom
 */

import { StorageKeys } from '../../../../utils/storage/types.js';
import { installTestSecretKek } from '../../../../utils/crypto/__tests__/secretKekHelper.js';
import { settingsRepository } from '../../../../utils/storage/SettingsRepository.js';
import {
  loadAndDisplaySources,
  deleteSource,
  reloadSource,
  saveUblockSettings
} from '../sourceManager.js';
import { RecordingCache } from '../../../../background/__tests__/helpers/recordingCache.js';

// 【重要】storage.tsのcachedSettingsを直接クリアするためのユーティリティ
// storage.tsのキャッシュは1秒間有効で、テスト間でリセットされない可能性がある
// テスト環境ではキャッシュを無効化する
const DISABLE_CACHE_IN_TESTS = async () => {
  // より直接的なアプローチ: clearSettingsCache後に待機して確実にクリアする
  settingsRepository.clearCache();

  // RecordingCacheのstaticキャッシュもクリア
  RecordingCache.invalidateSettingsCache();
  RecordingCache.invalidateUrlCache();
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
  const getMock = vi.fn((keys: any, callback: any) => {
    const result = { ...storage };
    if (callback) callback(result);
    return Promise.resolve(result);
  });

  const setMock = vi.fn((data: any, callback: any) => {
    // 【重要】saveSettings はトップレベルに StorageKeys のキーを保存するが、
    // getSettings は settings オブジェクト内から読むため、トップレベルキーを
    // settings オブジェクト内にマージする必要がある
    const merged = { ...storage };

    // StorageKeysのキーの場合はsettingsオブジェクト内にマージ
    const storageKeyValues: string[] = Object.values(StorageKeys);
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
    settingsRepository.clearCache();

    if (callback) callback();
    return Promise.resolve();
  });

  const removeMock = vi.fn((keys: any, callback: any) => {
    if (callback) callback();
    return Promise.resolve();
  });

  // Helper functions for test control
  const getStorageState = () => JSON.parse(JSON.stringify(storage));
  const setStorageState = (newState: any) => {
    // 【重要】永続フラグを保持しながらマージする
    // 【重要】StorageKeysのキー（ublock_sources等）はsettingsオブジェクト内に保存する
    const storageKeyValues: string[] = Object.values(StorageKeys);
    const processedState: any = {};

    // 永続フラグとバージョン
    processedState.settings_migrated = true;
    processedState.settings_version = newState.settings_version || 0;

    // 処理済み状態
    let settings: Record<string, unknown> = { ...INITIAL_STORAGE.settings };

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
    settingsRepository.clearCache();
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
    settingsRepository.clearCache();
  };

  // Replace global mocks
  (chrome.storage as { local: unknown }).local = {
    get: getMock,
    set: setMock,
    remove: removeMock,
    getBytesInUse: vi.fn(() => Promise.resolve(1024))
  } as any;

  return {
    getMock,
    setMock,
    getStorageState,
    setStorageState,
    resetStorage,
    restoreOriginal: () => {
      (chrome.storage as { local: unknown }).local = chromeStorageLocal;
    }
  };
}

// ============================================================================

describe('ublockImport - SourceManager Module', () => {
  let storageMocks: ReturnType<typeof createStorageMocks>;

  beforeEach(async () => {
    // PBI 25-25: fresh secret generation wraps with the dedicated KEK.
    await installTestSecretKek();
    // 新しいモックを作成して各テストが完全に分離された状態を持つようにする
    storageMocks = createStorageMocks();

    // ストレージ状態を完全にリセット
    storageMocks.resetStorage();

    // console.logを抑制（一時的に解除して調査）- 削除
    // vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    // モックを復元
    storageMocks?.restoreOriginal?.();

    // 【重要】storage.tsのキャッシュをクリア（各テスト終了時）
    // storage.test.tsと同じパターン
    settingsRepository.clearCache();
    RecordingCache.invalidateSettingsCache();
    RecordingCache.invalidateUrlCache();

    // jest.setup.js の localStorage をクリアして状態をリセット
    if (typeof localStorage !== 'undefined' && localStorage !== null) {
      Object.keys(localStorage).forEach(key => delete localStorage[key]);
    }
  });

  // ========================================================================
  // loadAndDisplaySources
  // ========================================================================

  describe('loadAndDisplaySources', () => {
    test('loads sources and calls the render callback', async () => {
      const renderCallback = vi.fn();

      await loadAndDisplaySources(renderCallback);

      expect(renderCallback).toHaveBeenCalled();
    });

    test('resolves without a render callback', async () => {
      const result = await loadAndDisplaySources();
      // No callback: sources are still read from storage and nothing is rendered.
      expect(result).toBeUndefined();
      expect(storageMocks.getMock).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // deleteSource
  // ========================================================================

  describe('deleteSource', () => {
    test('deletes the source at the given index', async () => {
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

      const renderCallback = vi.fn();
      await deleteSource(0, renderCallback);

      expect(renderCallback).toHaveBeenCalled();

      const state = storageMocks.getStorageState();
      expect(state.settings[StorageKeys.UBLOCK_SOURCES]).toHaveLength(1);
      expect(state.settings[StorageKeys.UBLOCK_SOURCES][0].url).toBe('https://example.com/filters2.txt');
    });

    test('leaves entries unchanged for an invalid index', async () => {
      storageMocks.setStorageState({
        settings: {
          ublock_sources: [],
          ublock_rules: {},
          ublock_format_enabled: false
        }
      });

      const renderCallback = vi.fn();
      await deleteSource(-1, renderCallback);

      // Bogus index: no render, no storage write, entries unchanged.
      expect(renderCallback).not.toHaveBeenCalled();
      expect(storageMocks.setMock).not.toHaveBeenCalled();
      const state = storageMocks.getStorageState();
      expect(state.settings[StorageKeys.UBLOCK_SOURCES]).toHaveLength(0);
    });
  });

  // ========================================================================
  // i18n seam (PBI 2026-10-15-01): user-facing strings resolve via dictionary
  // ========================================================================

  describe('i18n seam', () => {
    test('deleteSource resolves the success message through the dictionary', async () => {
      storageMocks.setStorageState({
        settings: {
          ublock_sources: [
            { url: 'https://example.com/filters.txt', ruleCount: 1, blockDomains: ['example.com'], exceptionDomains: [] }
          ],
          ublock_rules: {},
          ublock_format_enabled: true
        }
      });

      document.body.innerHTML = '<div id="uBlockStatus"></div>';
      await deleteSource(0);

      // Test env resolves the en dictionary: EN users no longer see Japanese.
      expect(document.getElementById('uBlockStatus')?.textContent).toBe('Source deleted');
    });

    test('saveUblockSettings resolves the added message with the rule count', async () => {
      storageMocks.setStorageState({
        settings: {
          ublock_sources: [],
          ublock_rules: {},
          ublock_format_enabled: false
        }
      });

      document.body.innerHTML = '<div id="uBlockStatus"></div>';
      await saveUblockSettings('||example.com^');

      // 英語の複数形対応: ruleCount=1 では `_one` キーが選ばれ「1 rules」にならない
      expect(document.getElementById('uBlockStatus')?.textContent).toBe('Filter source added (1 rule)');
    });

    test('uses the plural variant when the rule count is greater than one', async () => {
      storageMocks.setStorageState({
        settings: {
          ublock_sources: [],
          ublock_rules: {},
          ublock_format_enabled: false
        }
      });

      document.body.innerHTML = '<div id="uBlockStatus"></div>';
      await saveUblockSettings('||example.com^\n||test.com^');

      expect(document.getElementById('uBlockStatus')?.textContent).toBe('Filter source added (2 rules)');
    });

    test('writes to the visible uBlock status element, not the hidden #domainStatus', async () => {
      // #domainStatus は index.html で hidden 属性＋[hidden]{display:none!important}
      // により常に非表示なので、そこに書いた結果はユーザーに届かない（UI指摘）。
      storageMocks.setStorageState({
        settings: {
          ublock_sources: [],
          ublock_rules: {},
          ublock_format_enabled: false
        }
      });

      document.body.innerHTML = `
        <div id="domainStatus" hidden aria-live="polite"></div>
        <div id="uBlockStatus" class="status-message" aria-live="polite"></div>
      `;
      await saveUblockSettings('||example.com^');

      expect(document.getElementById('uBlockStatus')?.textContent).toBe('Filter source added (1 rule)');
      expect(document.getElementById('domainStatus')?.textContent).toBe('');
    });

    test('renders the delete result on the visible element too', async () => {
      storageMocks.setStorageState({
        settings: {
          ublock_sources: [
            { url: 'https://example.com/filters.txt', ruleCount: 1, blockDomains: ['example.com'], exceptionDomains: [] }
          ],
          ublock_rules: {},
          ublock_format_enabled: true
        }
      });

      document.body.innerHTML = `
        <div id="domainStatus" hidden aria-live="polite"></div>
        <div id="uBlockStatus" class="status-message" aria-live="polite"></div>
      `;
      await deleteSource(0);

      expect(document.getElementById('uBlockStatus')?.textContent).toBe('Source deleted');
      expect(document.getElementById('domainStatus')?.textContent).toBe('');
    });
  });

  // ========================================================================
  // fallback language (NN02): a missing key must surface the English
  // fallback, never Japanese
  // ========================================================================

  describe('fallback language', () => {
    test('uses the English fallback instead of Japanese when the key is missing', async () => {
      // Simulate a missing translation: real chrome.i18n returns '' for it,
      // so getMessageOr must fall through to its (English) fallback argument.
      vi.mocked(chrome.i18n.getMessage).mockReturnValueOnce('');

      const error = await saveUblockSettings('').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;

      expect(message).toBe('No valid rules found');
      expect(message).not.toMatch(/[\u3040-\u30ff\u4e00-\u9fff]/);
    });
  });

  // ========================================================================
  // reloadSource
  // ========================================================================

  describe('reloadSource', () => {
    test('reloads the source and updates it', async () => {
      storageMocks.setStorageState({
        settings: {
          ublock_sources: [
            { url: 'https://example.com/filters.txt', ruleCount: 2, blockDomains: ['example.com'], exceptionDomains: [] }
          ],
          ublock_rules: {},
          ublock_format_enabled: false
        }
      });

  
      const fetchFromUrlCallback = vi.fn().mockResolvedValue(`||example.com^\n||newdomain.com^`);

      const result = await reloadSource(0, fetchFromUrlCallback);

      expect(fetchFromUrlCallback).toHaveBeenCalledWith('https://example.com/filters.txt');
      expect(result.sources).toHaveLength(1);
      expect(result.ruleCount).toBeGreaterThan(0);
    });

    test('throws for an invalid index', async () => {
      storageMocks.setStorageState({
        settings: {
          ublock_sources: [],
          ublock_rules: {},
          ublock_format_enabled: false
        }
      });

      const fetchFromUrlCallback = vi.fn();

      await expect(reloadSource(100, fetchFromUrlCallback)).rejects.toThrow('Invalid index');
    });

    test('rejects reloading a manually entered source', async () => {
      storageMocks.setStorageState({
        settings: {
          ublock_sources: [
            { url: 'manual', ruleCount: 1, blockDomains: ['test.com'], exceptionDomains: [] }
          ],
          ublock_rules: {},
          ublock_format_enabled: false
        }
      });

      const fetchFromUrlCallback = vi.fn();

      await expect(reloadSource(0, fetchFromUrlCallback)).rejects.toThrow('Manually entered sources cannot be reloaded');
    });

    test('throws when parse errors exist', async () => {
      storageMocks.setStorageState({
        settings: {
          ublock_sources: [
            { url: 'https://example.com/filters.txt', ruleCount: 2, blockDomains: ['example.com'], exceptionDomains: [] }
          ],
          ublock_rules: {},
          ublock_format_enabled: false
        }
      });

  
      const fetchFromUrlCallback = vi.fn().mockResolvedValue('invalid line without caret');

      await expect(reloadSource(0, fetchFromUrlCallback)).rejects.toThrow('Errors found');
    });

    test('throws when the parse result has no rules', async () => {
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
  
      const fetchFromUrlCallback = vi.fn().mockResolvedValue('');

      await expect(reloadSource(0, fetchFromUrlCallback)).rejects.toThrow('Update aborted');
    });
  });

  // ========================================================================
  // saveUblockSettings
  // ========================================================================

  describe('saveUblockSettings', () => {
    test('saves valid filter text', async () => {
      const filterText = `||example.com^\n||test.com^`;

      const result = await saveUblockSettings(filterText);

      expect(result.action).toBe('追加');
      expect(result.ruleCount).toBe(2);
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0]!.url).toBe('manual');
      expect(result.sources[0]!.blockDomains).toContain('example.com');
    });

    test('stores the URL when one is given', async () => {
      const filterText = '||example.com^';
      const url = 'https://example.com/filters.txt';

      const result = await saveUblockSettings(filterText, url);

      expect(result.sources).toHaveLength(1);
      expect(result.sources[0]!.url).toBe('https://example.com/filters.txt');
    });

    test('throws when parse errors exist', async () => {
      const filterText = 'invalid line without caret';

      await expect(saveUblockSettings(filterText)).rejects.toThrow(/Errors found/);
    });

    test('throws when no valid rules exist', async () => {
      // 空文字列は入力バリデーションで早期リターン
      const filterText = '';

      await expect(saveUblockSettings(filterText)).rejects.toThrow('No valid rules found');
    });

    test('throws when the parsed rule count is zero', async () => {
      // コメントのみのフィルターテキスト - 有効な文字列だがルールは0
      const filterText = '! This is a comment\n! Another comment';

      await expect(saveUblockSettings(filterText)).rejects.toThrow('Errors found: no valid rules found');
    });

    test('saves a large rule set correctly', async () => {
      const largeFilterText = Array(1000).fill(0).map((_, i) => `||domain${i}.com^`).join('\n');

      const result = await saveUblockSettings(largeFilterText);

      expect(result.ruleCount).toBe(1000);
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0]!.url).toBe('manual');
    });

    test('updates the existing source instead of adding a duplicate URL', async () => {
      const url = 'https://example.com/filters.txt';

      // 最初の保存
      await saveUblockSettings('||example.com^', url);
      const state1 = storageMocks.getStorageState();
      expect(state1.settings[StorageKeys.UBLOCK_SOURCES]).toHaveLength(1);

      // 同じURLで更新
      const updRes = await saveUblockSettings('||updated.com^', url);

      expect(updRes.action).toBe('更新');
      expect(updRes.sources).toHaveLength(1);
      expect(updRes.sources[0]!.url).toBe(url);

      const state2 = storageMocks.getStorageState();
      expect(state2.settings[StorageKeys.UBLOCK_SOURCES]).toHaveLength(1);
    });

    test('keeps a single source across repeated manual saves', async () => {
      // 最初の保存
      await saveUblockSettings('||example.com^');
      const state1 = storageMocks.getStorageState();
      expect(state1.settings[StorageKeys.UBLOCK_SOURCES]).toHaveLength(1);

      // 同じURL（manual）で更新
      const updRes = await saveUblockSettings('||updated.com^');

      expect(updRes.action).toBe('更新');
      expect(updRes.sources).toHaveLength(1);

      const state2 = storageMocks.getStorageState();
      expect(state2.settings[StorageKeys.UBLOCK_SOURCES]).toHaveLength(1);
    });
  });

  describe('未設定の ublock_sources へのフォールバック', () => {
    test('loadAndDisplaySources passes an empty array when sources are unset', async () => {
      storageMocks.setStorageState({ settings: { ublock_sources: undefined } });

      const renderCallback = vi.fn();
      await loadAndDisplaySources(renderCallback);

      expect(renderCallback).toHaveBeenCalledWith([]);
    });

    test('deleteSource does nothing when sources are unset', async () => {
      storageMocks.setStorageState({ settings: { ublock_sources: undefined } });

      const renderCallback = vi.fn();
      await deleteSource(0, renderCallback);

      expect(renderCallback).not.toHaveBeenCalled();
    });

    test('reloadSource throws when sources are unset', async () => {
      storageMocks.setStorageState({ settings: { ublock_sources: undefined } });

      const fetchFromUrlCallback = vi.fn();
      await expect(reloadSource(0, fetchFromUrlCallback)).rejects.toThrow('Invalid index');
    });

    test('saveUblockSettings adds a new source when sources are unset', async () => {
      storageMocks.setStorageState({ settings: { ublock_sources: undefined } });

      const result = await saveUblockSettings('||example.com^');

      expect(result.action).toBe('追加');
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0]!.url).toBe('manual');
    });
  });

  describe('一部無効な行を含むフィルター', () => {
    test('reloadSource updates with a warning when valid rules exist', async () => {
      storageMocks.setStorageState({
        settings: {
          ublock_sources: [
            { url: 'https://example.com/filters.txt', ruleCount: 1, blockDomains: ['example.com'], exceptionDomains: [] }
          ],
          ublock_rules: {},
          ublock_format_enabled: false
        }
      });

      const logger = await import('../../../../utils/logger/api.js');
      const warnSpy = vi.spyOn(logger, 'logWarn').mockResolvedValue(undefined);
      try {
        const fetchFromUrlCallback = vi.fn().mockResolvedValue('||example.com^\ninvalid line without caret');
        const result = await reloadSource(0, fetchFromUrlCallback);

        expect(result.ruleCount).toBe(1);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('skipped invalid lines'),
          expect.objectContaining({ skipped: 1, ruleCount: 1 }),
          expect.any(String),
          'sourceManager',
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    test('saveUblockSettings saves with a warning when valid rules exist', async () => {
      const logger = await import('../../../../utils/logger/api.js');
      const warnSpy = vi.spyOn(logger, 'logWarn').mockResolvedValue(undefined);
      try {
        const result = await saveUblockSettings('||example.com^\ninvalid line without caret');

        expect(result.action).toBe('追加');
        expect(result.ruleCount).toBe(1);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('skipped invalid lines'),
          expect.objectContaining({ skipped: 1, ruleCount: 1 }),
          expect.any(String),
          'sourceManager',
        );
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});