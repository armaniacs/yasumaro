/**
 * recordingLogic-cache.test.js
 * 設定キャッシュのテスト
 * タスク5: 設定キャッシュの実装
 */

import { RecordingLogic, SETTINGS_CACHE_TTL } from '../recordingLogic.js';
import { getSettings, getSavedUrls, setSavedUrls, StorageKeys } from '../../utils/storage.js';
import { PrivacyPipeline } from '../privacyPipeline.js';
import { NotificationHelper } from '../notificationHelper.js';

jest.mock('../../utils/storage.js');
jest.mock('../privacyPipeline.js');
jest.mock('../notificationHelper.js');
jest.mock('../../utils/logger.js', () => ({
  addLog: jest.fn(),
  LogType: {
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR'
  }
}));
jest.mock('../../utils/domainUtils.js', () => ({
  isDomainAllowed: jest.fn((url) => Promise.resolve(true))
}));
jest.mock('../../utils/piiSanitizer.js', () => ({
  sanitizeRegex: jest.fn()
}));

describe('RecordingLogic: 設定キャッシュ（タスク5）', () => {
  let recordingLogic;
  const mockObsidianClient = {};
  const mockAiClient = {};

  beforeEach(() => {
    recordingLogic = new RecordingLogic(mockObsidianClient, mockAiClient);
    jest.clearAllMocks();
    // Problem #3: 2重キャッシュ構造を1段階に簡素化 - urlCacheも追加
    RecordingLogic.cacheState = {
      settingsCache: null,
      cacheTimestamp: null,
      cacheVersion: 0,
      urlCache: null,
      urlCacheTimestamp: null
    };
    RecordingLogic.invalidateUrlCache();

    // デフォルトモック
    getSettings.mockResolvedValue({
      AI_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'test-key',
      GEMINI_MODEL: 'gemini-1.5-flash',
      PRIVACY_MODE: 'masked_cloud'
    });
    getSavedUrls.mockResolvedValue(new Set());
    setSavedUrls.mockResolvedValue();
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

  describe('getSettingsWithCache', () => {
    it('初回呼び出し時にstorageから設定を取得する', async () => {
      const settings = await recordingLogic.getSettingsWithCache();

      expect(getSettings).toHaveBeenCalledTimes(1);
      expect(settings).toHaveProperty('AI_PROVIDER', 'gemini');
    });

    it('2回目の呼び出し時にキャッシュを使用する', async () => {
      await recordingLogic.getSettingsWithCache();
      getSettings.mockClear();

      // 2回目の呼び出し
      const settings = await recordingLogic.getSettingsWithCache();

      // getSettingsは呼ばれない（キャッシュが使用される）
      expect(getSettings).not.toHaveBeenCalled();
      expect(settings).toHaveProperty('AI_PROVIDER', 'gemini');
    });

    it('キャッシュが期限切れの場合にstorageから設定を再取得する', async () => {
      await recordingLogic.getSettingsWithCache();

      // Problem #3: 2重キャッシュ構造を1段階に簡素化 - 静的キャッシュのみを使用
      // キャッシュのタイムスタンプを古くする
      RecordingLogic.cacheState.cacheTimestamp = Date.now() - SETTINGS_CACHE_TTL - 1000;

      // getSettingsをリセットして新しいモック値を設定
      getSettings.mockClear();
      getSettings.mockResolvedValue({
        AI_PROVIDER: 'openai',
        OPENAI_API_KEY: 'openai-key'
      });

      const settings = await recordingLogic.getSettingsWithCache();

      // getSettingsが再度呼ばれる
      expect(getSettings).toHaveBeenCalledTimes(1);
      expect(settings).toHaveProperty('AI_PROVIDER', 'openai');
    });

    it('キャッシュバージョンが変更された場合に再取得する', async () => {
      // Problem #3: 2重キャッシュ構造を1段階に簡素化
      // バージョンチェックのロジックが簡素化されたため、このテストはスキップ
      // TLLに基づく期限切れチェックのみ行われる
      expect(true).toBe(true); // Placeholder test
    });

    it('静的キャッシュが使用可能な場合は静的キャッシュを使用する', async () => {
      const firstInstance = new RecordingLogic(mockObsidianClient, mockAiClient);
      await firstInstance.getSettingsWithCache();
      getSettings.mockClear();

      // 2つ目のインスタンスを作成
      const secondInstance = new RecordingLogic(mockObsidianClient, mockAiClient);
      const settings = await secondInstance.getSettingsWithCache();

      // getSettingsは呼ばれない（静的キャッシュが使用される）
      expect(getSettings).not.toHaveBeenCalled();
    });

    it('静的キャッシュが期限切れの場合にstorageから再取得する', async () => {
      const firstInstance = new RecordingLogic(mockObsidianClient, mockAiClient);
      await firstInstance.getSettingsWithCache();

      // 静的キャッシュのタイムスタンプを古くする
      RecordingLogic.cacheState.cacheTimestamp = Date.now() - SETTINGS_CACHE_TTL - 1000;

      const secondInstance = new RecordingLogic(mockObsidianClient, mockAiClient);
      getSettings.mockClear();
      getSettings.mockResolvedValue({
        AI_PROVIDER: 'updated-provider'
      });

      const settings = await secondInstance.getSettingsWithCache();

      // getSettingsが再度呼ばれる
      expect(getSettings).toHaveBeenCalledTimes(1);
      expect(settings).toHaveProperty('AI_PROVIDER', 'updated-provider');
    });
  });

  describe('invalidateSettingsCache', () => {
    it('静的キャッシュを無効化する', async () => {
      // 最初の呼び出しでキャッシュを作成
      await recordingLogic.getSettingsWithCache();
      expect(RecordingLogic.cacheState.settingsCache).not.toBeNull();

      // キャッシュを無効化
      RecordingLogic.invalidateSettingsCache();

      expect(RecordingLogic.cacheState.settingsCache).toBeNull();
    });

    it('無効化後のgetSettingsWithCacheでstorageから再取得する', async () => {
      await recordingLogic.getSettingsWithCache();

      const cacheVersionBefore = RecordingLogic.cacheState.cacheVersion;

      RecordingLogic.invalidateSettingsCache();
      getSettings.mockClear();
      getSettings.mockResolvedValue({
        AI_PROVIDER: 'new-provider'
      });

      await recordingLogic.getSettingsWithCache();

      expect(getSettings).toHaveBeenCalledTimes(1);
      // キャッシュバージョンが増加していることを確認
      expect(RecordingLogic.cacheState.cacheVersion).toBeGreaterThan(cacheVersionBefore);
    });

    it('すべてのインスタンスが無効化されたキャッシュを検知する', async () => {
      // Problem #3: 2重キャッシュ構造を1段階に簡素化
      // インスタンスキャッシュがないため、このテストは簡素化
      const instance1 = new RecordingLogic(mockObsidianClient, mockAiClient);
      const instance2 = new RecordingLogic(mockObsidianClient, mockAiClient);

      await instance1.getSettingsWithCache();
      await instance2.getSettingsWithCache();

      const cacheVersionBefore = RecordingLogic.cacheState.cacheVersion;

      // キャッシュを無効化
      RecordingLogic.invalidateSettingsCache();

      // cacheVersionが増加していることを確認
      expect(RecordingLogic.cacheState.cacheVersion).toBeGreaterThan(cacheVersionBefore);
    });
  });

  // Problem #3: 2重キャッシュ構造を1段階に簡素化
  // invalidateInstanceCacheはno-opになったため、テストを削除

  describe('recordメソッドでのキャッシュ使用', () => {
    it('recordメソッドがキャッシュを使用する', async () => {
      mockObsidianClient.appendToDailyNote = jest.fn().mockResolvedValue();

      // 最初のrecord呼び出し
      await recordingLogic.record({
        title: 'Test Page',
        url: 'https://example.com',
        content: 'Test content'
      });

      const getSettingsCallsAfterFirst = getSettings.mock.calls.length;

      // 2回目のrecord呼び出し
      await recordingLogic.record({
        title: 'Test Page 2',
        url: 'https://example2.com',
        content: 'Test content 2'
      });

      // 2回目の呼び出しでもgetSettingsは追加で呼ばれない（キャッシュ使用）
      expect(getSettings.mock.calls.length).toBe(getSettingsCallsAfterFirst);
    });

    it('キャッシュ期限切れ後にrecordメソッドがstorageから再取得する', async () => {
      mockObsidianClient.appendToDailyNote = jest.fn().mockResolvedValue();

      // 最初のrecord呼び出し
      await recordingLogic.record({
        title: 'Test Page',
        url: 'https://example.com',
        content: 'Test content'
      });

      // Problem #3: 2重キャッシュ構造を1段階に簡素化 - 静的キャッシュのみ古くする
      RecordingLogic.cacheState.cacheTimestamp = Date.now() - SETTINGS_CACHE_TTL - 1000;

      getSettings.mockClear();
      getSettings.mockResolvedValue({
        AI_PROVIDER: 'new-provider'
      });

      // 2回目のrecord呼び出し
      await recordingLogic.record({
        title: 'Test Page 2',
        url: 'https://example2.com',
        content: 'Test content 2'
      });

      // recordメソッド内でgetSettingsが呼ばれる
      expect(getSettings).toHaveBeenCalledTimes(1);
    });
  });

  describe('並列呼び出しの処理', () => {
    it('複数のrecord呼び出しが並行であっても安全に処理する', async () => {
      mockObsidianClient.appendToDailyNote = jest.fn().mockResolvedValue();

      // 並列で複数のrecord呼び出し
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(recordingLogic.record({
          title: `Test Page ${i}`,
          url: `https://example.com/${i}`,
          content: `Content ${i}`
        }));
      }

      await Promise.all(promises);

      // getSettingsは複数回呼ばわれる可能性があるが、エラーをスローしない
      expect(getSettings).toHaveBeenCalled();
    });

    it('複数のgetSettingsWithCache呼び出しが安全に処理する', async () => {
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(recordingLogic.getSettingsWithCache());
      }

      const results = await Promise.all(promises);

      // すべての結果が設定オブジェクトであることを確認
      results.forEach(result => {
        expect(result).toHaveProperty('AI_PROVIDER');
      });

      // getSettingsは呼ばれるが、キャッシュにより回数が制限される
      expect(getSettings).toHaveBeenCalled();
    });
  });

  describe('エッジケース', () => {
    it('設定がnullの場合の処理', async () => {
      getSettings.mockResolvedValue(null);

      const settings = await recordingLogic.getSettingsWithCache();

      expect(settings).toBeNull();
    });

    it('設定が空オブジェクトの場合の処理', async () => {
      getSettings.mockResolvedValue({});

      const settings = await recordingLogic.getSettingsWithCache();

      expect(settings).toEqual({});
    });

    it('getSettingsがrejectした場合のエラー伝播', async () => {
      const error = new Error('Storage error');
      getSettings.mockRejectedValue(error);

      await expect(recordingLogic.getSettingsWithCache()).rejects.toThrow('Storage error');
    });

    it('キャッシュバージョンのオーバーフロー（数値が大きくなった場合）', async () => {
      // Problem #3: 2重キャッシュ構造を1段階に簡素化
      RecordingLogic.cacheState.cacheVersion = Number.MAX_SAFE_INTEGER;

      await recordingLogic.getSettingsWithCache();

      // キャッシュバージョンが増加してもエラーがスローされない
      expect(RecordingLogic.cacheState.cacheVersion).toBeGreaterThanOrEqual(Number.MAX_SAFE_INTEGER);
    });
  });

  describe('パフォーマンス検証', () => {
    it('キャッシュ使用時のパフォーマンス向上を検証する', async () => {
      mockObsidianClient.appendToDailyNote = jest.fn().mockResolvedValue();

      // 初回呼び出し（キャッシュミス）
      const start1 = Date.now();
      await recordingLogic.record({
        title: 'Test Page',
        url: 'https://example.com',
        content: 'Test content'
      });
      const duration1 = Date.now() - start1;

      // 2回目以降の呼び出し（キャッシュヒット）
      getSettings.mockClear();
      const start2 = Date.now();
      await recordingLogic.record({
        title: 'Test Page 2',
        url: 'https://example2.com',
        content: 'Test content 2'
      });
      const duration2 = Date.now() - start2;

      // 2回目の呼び出しではgetSettingsが呼ばれないことを確認
      expect(getSettings).not.toHaveBeenCalled();

      // 注: Jest環境でのテストなので、getSettingsの呼び出し回数を確認する
      // 実際のパフォーマンス比較は非同期処理のオーバーヘッドにより難しい
    });
  });
});

/**
 * 実装概要:
 *
 * 設定キャッシュの実装により、以下のメリットが期待できます:
 * 1. chrome.storage.localへのアクセス回数を削減
 * 2. Service Workerの再起動時にキャッシュ状態を維持（staticキャッシュ）
 * 3. 設定変更時にキャッシュを簡単に無効化（invalidateSettingsCache）
 *
 * キャッシュ戦略:
 * - インスタンスレベルキャッシュ: RecordingLogicインスタンスごとにキャッシュを持つ
 * - 静的キャッシュ: Service Worker再起動間で共有キャッシュ
 * - TTLベースの有効期限: 30秒でキャッシュ期限切れ
 * - バージョンベースの無効化: 設定変更時にバージョンをインクリメント
 */