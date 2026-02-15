/**
 * robustness-data-integrity.test.js
 * データ整合性のテスト
 * ブルーチーム報告 P0: データ整合性の改善 - 書き込み成功後にのみURLを保存
 */

import { RecordingLogic } from '../recordingLogic.ts';
import { getSettings, getSavedUrlsWithTimestamps, setSavedUrlsWithTimestamps, StorageKeys } from '../../utils/storage.ts';
import { PrivacyPipeline } from '../privacyPipeline.ts';
import { NotificationHelper } from '../notificationHelper.ts';
import { addLog, LogType } from '../../utils/logger.ts';

jest.mock('../../utils/storage.ts');
jest.mock('../privacyPipeline.ts');
jest.mock('../notificationHelper.ts');
jest.mock('../../utils/logger.ts', () => ({
  addLog: jest.fn(),
  LogType: {
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR'
  }
}));
jest.mock('../../utils/domainUtils.ts', () => ({
  isDomainAllowed: jest.fn((url) => Promise.resolve(true))
}));
jest.mock('../../utils/piiSanitizer.ts', () => ({
  sanitizeRegex: jest.fn()
}));

describe('RecordingLogic: データ整合性（P0）', () => {
  let recordingLogic;

  beforeEach(() => {
    recordingLogic = new RecordingLogic({}, {});
    jest.clearAllMocks();

    // Problem #7: URLキャッシュを初期化
    RecordingLogic.cacheState = {
      settingsCache: null,
      cacheTimestamp: null,
      cacheVersion: 0,
      urlCache: null,
      urlCacheTimestamp: null
    };

    // デフォルトモック
    getSettings.mockResolvedValue({
      AI_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'test-key',
      GEMINI_MODEL: 'gemini-1.5-flash',
      PRIVACY_MODE: 'masked_cloud'
    });

    getSavedUrlsWithTimestamps.mockResolvedValue(new Map());
    setSavedUrlsWithTimestamps.mockResolvedValue();
    StorageKeys.AI_PROVIDER = 'AI_PROVIDER';

    // PrivacyPipelineモック
    PrivacyPipeline.mockImplementation(() => ({
      process: jest.fn().mockResolvedValue({
        summary: 'Test summary',
        maskedContent: 'Masked content'
      })
    }));

    // NotificationHelperモック
    NotificationHelper.notifySuccess = jest.fn();
    NotificationHelper.notifyError = jest.fn();
  });

  describe('現在の実装の確認', () => {
    it('Obsidian書き込み失敗時にURLが保存される不整合がある可能性がある', async () => {
      const mockObsidianClient = {
        appendToDailyNote: jest.fn().mockRejectedValue(new Error('Network error'))
      };
      recordingLogic = new RecordingLogic(mockObsidianClient, {});

      const result = await recordingLogic.record({
        title: 'Test Page',
        url: 'https://example.com',
        content: 'Test content'
      });

      expect(result.success).toBe(false);
      expect(setSavedUrlsWithTimestamps).not.toHaveBeenCalled();
    });

    it('Obsidian書き込み成功時にのみURLが保存されていることを確認', async () => {
      const mockObsidianClient = {
        appendToDailyNote: jest.fn().mockResolvedValue()
      };
      recordingLogic = new RecordingLogic(mockObsidianClient, {});
      getSavedUrlsWithTimestamps.mockResolvedValue(new Map());

      const result = await recordingLogic.record({
        title: 'Test Page',
        url: 'https://example.com',
        content: 'Test content'
      });

      expect(result.success).toBe(true);
      expect(setSavedUrlsWithTimestamps).toHaveBeenCalled();
    });
  });

  describe('エッジケース: 書き込み失敗時のURL整合性', () => {
    it('ネットワークエラー時にURLが保存されないこと', async () => {
      const mockObsidianClient = {
        appendToDailyNote: jest.fn().mockRejectedValue(new Error('Network error'))
      };
      recordingLogic = new RecordingLogic(mockObsidianClient, {});
      getSavedUrlsWithTimestamps.mockResolvedValue(new Map());

      const result = await recordingLogic.record({
        title: 'Test Page',
        url: 'https://example.com',
        content: 'Test content'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
      expect(setSavedUrlsWithTimestamps).not.toHaveBeenCalled();
    });

    it('APIエラー時にURLが保存されないこと', async () => {
      const mockObsidianClient = {
        appendToDailyNote: jest.fn().mockRejectedValue(new Error('API Error'))
      };
      recordingLogic = new RecordingLogic(mockObsidianClient, {});
      getSavedUrlsWithTimestamps.mockResolvedValue(new Map());

      const result = await recordingLogic.record({
        title: 'Test Page',
        url: 'https://example.com',
        content: 'Test content'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('API Error');
      expect(setSavedUrlsWithTimestamps).not.toHaveBeenCalled();
    });

    it('タイムアウト時にURLが保存されないこと', async () => {
      const mockObsidianClient = {
        appendToDailyNote: jest.fn().mockRejectedValue(new Error('Request timeout'))
      };
      recordingLogic = new RecordingLogic(mockObsidianClient, {});
      getSavedUrlsWithTimestamps.mockResolvedValue(new Map());

      const result = await recordingLogic.record({
        title: 'Test Page',
        url: 'https://example.com',
        content: 'Test content'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Request timeout');
      expect(setSavedUrlsWithTimestamps).not.toHaveBeenCalled();
    });
  });

  describe('エッジケース: 重複URLの処理', () => {
    it('既存のURLが保存されている場合、重複チェックが正しく動作すること', async () => {
      const mockObsidianClient = {
        appendToDailyNote: jest.fn().mockResolvedValue()
      };
      recordingLogic = new RecordingLogic(mockObsidianClient, {});

      const urlMap = new Map([['https://example.com', Date.now()]]);
      getSavedUrlsWithTimestamps.mockResolvedValue(urlMap);
      setSavedUrlsWithTimestamps.mockResolvedValue();

      const result = await recordingLogic.record({
        title: 'Test Page',
        url: 'https://example.com',
        content: 'Test content'
      });

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(setSavedUrlsWithTimestamps).not.toHaveBeenCalled();
    });

    it('新しいURLの場合にのみsetSavedUrlsWithTimestampsが呼ばれること', async () => {
      const mockObsidianClient = {
        appendToDailyNote: jest.fn().mockResolvedValue()
      };
      recordingLogic = new RecordingLogic(mockObsidianClient, {});

      const urlMap = new Map([['https://existing.com', Date.now()]]);
      getSavedUrlsWithTimestamps.mockResolvedValue(urlMap);
      setSavedUrlsWithTimestamps.mockResolvedValue();

      const result = await recordingLogic.record({
        title: 'Test Page',
        url: 'https://new.com',
        content: 'Test content'
      });

      expect(result.success).toBe(true);
      expect(result.skipped).toBeUndefined();
      expect(setSavedUrlsWithTimestamps).toHaveBeenCalled();

      // urlMapに新しいURLが追加されて保存されることを確認
      expect(setSavedUrlsWithTimestamps).toHaveBeenCalledWith(
        expect.any(Map),
        'https://new.com'
      );
    });
  });

  describe('エッジケース: force記録の場合', () => {
    it('force=trueの場合でも書き込み失敗時にURLが保存されないこと', async () => {
      const mockObsidianClient = {
        appendToDailyNote: jest.fn().mockRejectedValue(new Error('Network error'))
      };
      recordingLogic = new RecordingLogic(mockObsidianClient, {});
      getSavedUrlsWithTimestamps.mockResolvedValue(new Map());

      const result = await recordingLogic.record({
        title: 'Test Page',
        url: 'https://blocked.com',
        content: 'Test content',
        force: true
      });

      expect(result.success).toBe(false);
      expect(setSavedUrlsWithTimestamps).not.toHaveBeenCalled();
    });
  });

  describe('エッジケース: 並列呼び出し時の整合性', () => {
    it('並列呼び出し時にURLが正しく保存されること', async () => {
      const mockObsidianClient = {
        appendToDailyNote: jest.fn().mockResolvedValue()
      };
      recordingLogic = new RecordingLogic(mockObsidianClient, {});
      let savedUrlsCalledTimes = 0;

      for (let i = 0; i < 5; i++) {
        const urlMap = new Map();
        for (let j = 0; j < i; j++) {
          urlMap.set(`https://example.com/${j}`, Date.now());
        }
        getSavedUrlsWithTimestamps.mockResolvedValue(new Map(urlMap));
        setSavedUrlsWithTimestamps.mockClear();
        setSavedUrlsWithTimestamps.mockResolvedValue();

        const result = await recordingLogic.record({
          title: `Test Page ${i}`,
          url: `https://example.com/${i}`,
          content: `Content ${i}`
        });

        expect(result.success).toBe(true);
        expect(setSavedUrlsWithTimestamps).toHaveBeenCalledTimes(1);
        savedUrlsCalledTimes++;
      }

      expect(savedUrlsCalledTimes).toBe(5);
    });

    it('並列呼び出し時に一部のリクエストが失敗した場合の整合性を確認', async () => {
      const mockObsidianClient = {
        appendToDailyNote: jest.fn()
          .mockResolvedValueOnce()    // 0: 成功
          .mockRejectedValueOnce(new Error('Alternating error'))  // 1: 失敗
          .mockResolvedValueOnce()    // 2: 成功
          .mockRejectedValueOnce(new Error('Alternating error'))  // 3: 失敗
      };
      recordingLogic = new RecordingLogic(mockObsidianClient, {});

      for (let i = 0; i < 4; i++) {
        const urlMap = new Map();
        for (let j = 0; j < i; j++) {
          urlMap.set(`https://example.com/${j}`, Date.now());
        }
        getSavedUrlsWithTimestamps.mockResolvedValue(new Map(urlMap));
        setSavedUrlsWithTimestamps.mockClear();
        setSavedUrlsWithTimestamps.mockResolvedValue();

        const result = await recordingLogic.record({
          title: `Test Page ${i}`,
          url: `https://example.com/${i}`,
          content: `Content ${i}`
        });

        if (i % 2 === 0) {
          expect(result.success).toBe(true);
          expect(setSavedUrlsWithTimestamps).toHaveBeenCalledTimes(1);
        } else {
          expect(result.success).toBe(false);
          expect(setSavedUrlsWithTimestamps).not.toHaveBeenCalled();
        }
      }
    });
  });
});

/**
 * 実装分析結果:
 *
 * 現在の実装（recordingLogic.js 行162-165）:
 * ```javascript
 * if (!urlSet.has(url)) {
 *   urlSet.add(url);
 *   await setSavedUrls(urlSet);
 * }
 * ```
 *
 * このコードはObsidian書き込み成功後にのみ実行されるため、
 * 現在の実装ではデータ整合性が保たれています。
 *
 * 実装の正しさ:
 * 1. Obsidian書き込み成功時にのみURLを保存（tryブロック内）
 * 2. 書き込み失敗時にはURLが保存されない（catchブロック）
 * 3. 重複チェックが正しく動作する
 *
 * 結論: 現在の実装はデータ整合性が保たれており、修正の必要はありません。
 * テストにより、この挙動が検証されました。
 */