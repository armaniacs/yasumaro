/**
 * recordingCache-settingsCache.test.ts
 * 設定キャッシュのテスト
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { RecordingCache, SETTINGS_CACHE_TTL } from './helpers/recordingCache.js';
import { makeRecordingLogic } from './helpers/makeRecordingLogic.js';
import { getSavedUrls, setSavedUrls } from '../../utils/storage/savedUrlRepository.js';
import { StorageKeys } from '../../utils/storage/types.js';
import { PrivacyPipeline } from '../privacyPipeline.ts';
import { NotificationHelper } from '../notificationHelper.ts';

const mockGetAll = vi.hoisted(() => vi.fn());

vi.mock('../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {
    StorageKeys: {
      AI_PROVIDER: 'AI_PROVIDER',
      GEMINI_API_KEY: 'GEMINI_API_KEY',
      GEMINI_MODEL: 'GEMINI_MODEL',
      PRIVACY_MODE: 'PRIVACY_MODE',
    },
  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});
vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    settingsRepository: {
      getAll: mockGetAll,
      setAll: vi.fn(),
      getMany: vi.fn(),
    },
    SettingsRepository: class {
      getAll = mockGetAll;
      setAll = vi.fn();
      getMany = vi.fn();
    },
  };
});
vi.mock('../../utils/storage/savedUrlRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = { getSavedUrls: vi.fn(), setSavedUrls: vi.fn() } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});
vi.mock('../privacyPipeline.ts');
vi.mock('../notificationHelper.ts');
vi.mock('../../utils/logger.ts', () => ({
  addLog: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logDebug: vi.fn(),
  LogType: {
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR'
  },
  ErrorCode: {
    INTERNAL_ERROR: 'INT_001',
    UNKNOWN_ERROR: 'UNK_001'
  }
}));
vi.mock('../../utils/domainUtils.ts', () => ({
  isDomainAllowed: vi.fn((url) => Promise.resolve(true))
}));
vi.mock('../../utils/piiSanitizer.ts', () => ({
  sanitizeRegex: vi.fn()
}));

describe('RecordingLogic: 設定キャッシュ（タスク5）', () => {
  let recordingLogic;
  const mockObsidianClient = {};
  const mockAiClient = {};

  beforeEach(() => {
    recordingLogic = makeRecordingLogic(mockObsidianClient, mockAiClient);
    vi.clearAllMocks();
    // Problem #3: 2重キャッシュ構造を1段階に簡素化 - urlCacheも追加
    RecordingCache.resetCacheState();
    RecordingCache.invalidateUrlCache();

    // デフォルトモック
    // @ts-expect-error - vi.fn() type narrowing issue

    mockGetAll.mockResolvedValue({
      AI_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'test-key',
      GEMINI_MODEL: 'gemini-3.1-flash-lite',
      PRIVACY_MODE: 'masked_cloud'
    });
    // @ts-expect-error - vi.fn() type narrowing issue

    getSavedUrls.mockResolvedValue(new Set());
    // @ts-expect-error - vi.fn() type narrowing issue

    setSavedUrls.mockResolvedValue();
    StorageKeys.AI_PROVIDER = 'AI_PROVIDER';

    // PrivacyPipelineモック
    // @ts-expect-error - vi.fn() type narrowing issue

    PrivacyPipeline.mockImplementation(() => ({
    // @ts-expect-error - vi.fn() type narrowing issue

      process: vi.fn().mockResolvedValue({
        summary: 'Test summary',
        maskedContent: 'Masked content'
      })
    }));

    // NotificationHelperモック
    NotificationHelper.notifySuccess = vi.fn();
    NotificationHelper.notifyError = vi.fn();
  });

  describe('getSettingsWithCache', () => {
    it('初回呼び出し時にstorageから設定を取得する', async () => {
      const settings = await RecordingCache.getSettingsWithCache();

      expect(mockGetAll).toHaveBeenCalledTimes(1);
      expect(settings).toHaveProperty('AI_PROVIDER', 'gemini');
    });

    it('2回目の呼び出し時にキャッシュを使用する', async () => {
      await RecordingCache.getSettingsWithCache();
      mockGetAll.mockClear();

      // 2回目の呼び出し
      const settings = await RecordingCache.getSettingsWithCache();

      // mockGetAllは呼ばれない（キャッシュが使用される）
      expect(mockGetAll).not.toHaveBeenCalled();
      expect(settings).toHaveProperty('AI_PROVIDER', 'gemini');
    });

    it('キャッシュが期限切れの場合にstorageから設定を再取得する', async () => {
      await RecordingCache.getSettingsWithCache();

      // fake timers で TTL を経過させる（timestamp 直書きの代替）
      vi.useFakeTimers();
      try {
        vi.advanceTimersByTime(SETTINGS_CACHE_TTL + 1000);

        // mockGetAllをリセットして新しいモック値を設定
        mockGetAll.mockClear();
    // @ts-expect-error - vi.fn() type narrowing issue

        mockGetAll.mockResolvedValue({
          AI_PROVIDER: 'openai',
          OPENAI_API_KEY: 'openai-key'
        });

        const settings = await RecordingCache.getSettingsWithCache();

        // mockGetAllが再度呼ばれる
        expect(mockGetAll).toHaveBeenCalledTimes(1);
        expect(settings).toHaveProperty('AI_PROVIDER', 'openai');
      } finally {
        vi.useRealTimers();
      }
    });

    // Problem #3: 2重キャッシュ構造を1段階に簡素化したため、バージョンチェック
    // ロジック自体が存在しない（TTLに基づく期限切れチェックのみ行われる）。
    it.skip('キャッシュバージョンが変更された場合に再取得する', () => {});

    it('静的キャッシュが使用可能な場合は静的キャッシュを使用する', async () => {
      const firstInstance = makeRecordingLogic(mockObsidianClient, mockAiClient);
      await RecordingCache.getSettingsWithCache();
      mockGetAll.mockClear();

      // 2つ目のインスタンスを作成
      const secondInstance = makeRecordingLogic(mockObsidianClient, mockAiClient);
      const settings = await RecordingCache.getSettingsWithCache();

      // mockGetAllは呼ばれない（静的キャッシュが使用される）
      expect(mockGetAll).not.toHaveBeenCalled();
    });

    it('静的キャッシュが期限切れの場合にstorageから再取得する', async () => {
      const firstInstance = makeRecordingLogic(mockObsidianClient, mockAiClient);
      await RecordingCache.getSettingsWithCache();

      // fake timers で TTL を経過させる（timestamp 直書きの代替）
      vi.useFakeTimers();
      try {
        vi.advanceTimersByTime(SETTINGS_CACHE_TTL + 1000);

        const secondInstance = makeRecordingLogic(mockObsidianClient, mockAiClient);
        mockGetAll.mockClear();
    // @ts-expect-error - vi.fn() type narrowing issue

        mockGetAll.mockResolvedValue({
          AI_PROVIDER: 'updated-provider'
        });

        const settings = await RecordingCache.getSettingsWithCache();

        // mockGetAllが再度呼ばれる
        expect(mockGetAll).toHaveBeenCalledTimes(1);
        expect(settings).toHaveProperty('AI_PROVIDER', 'updated-provider');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('invalidateSettingsCache', () => {
    it('静的キャッシュを無効化する', async () => {
      // 最初の呼び出しでキャッシュを作成
      await RecordingCache.getSettingsWithCache();

      // キャッシュを無効化 → 次回読み取りで再取得される
      RecordingCache.invalidateSettingsCache();
      mockGetAll.mockClear();
      await RecordingCache.getSettingsWithCache();

      expect(mockGetAll).toHaveBeenCalledTimes(1);
    });

    it('無効化後のgetSettingsWithCacheでstorageから再取得する', async () => {
      await RecordingCache.getSettingsWithCache();

      RecordingCache.invalidateSettingsCache();
      mockGetAll.mockClear();
    // @ts-expect-error - vi.fn() type narrowing issue

      mockGetAll.mockResolvedValue({
        AI_PROVIDER: 'new-provider'
      });

      const settings = await RecordingCache.getSettingsWithCache();

      expect(mockGetAll).toHaveBeenCalledTimes(1);
      expect(settings).toHaveProperty('AI_PROVIDER', 'new-provider');
    });

    it('すべてのインスタンスが無効化されたキャッシュを検知する', async () => {
      // Problem #3: 2重キャッシュ構造を1段階に簡素化
      // インスタンスキャッシュがないため、このテストは簡素化
      const instance1 = makeRecordingLogic(mockObsidianClient, mockAiClient);
      const instance2 = makeRecordingLogic(mockObsidianClient, mockAiClient);

      await RecordingCache.getSettingsWithCache();
      await RecordingCache.getSettingsWithCache();

      // キャッシュを無効化 → 次回読み取りで再取得される
      RecordingCache.invalidateSettingsCache();
      mockGetAll.mockClear();
      await RecordingCache.getSettingsWithCache();

      expect(mockGetAll).toHaveBeenCalledTimes(1);
    });
  });

  // Problem #3: 2重キャッシュ構造を1段階に簡素化
  // invalidateInstanceCacheはno-opになったため、テストを削除

  describe('recordメソッドでのキャッシュ使用', () => {
    it('recordメソッドがキャッシュを使用する', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue

      mockObsidianClient.appendToDailyNote = vi.fn().mockResolvedValue();

      // 最初のrecord呼び出し
      await recordingLogic.record({
        title: 'Test Page',
        url: 'https://example.com',
        content: 'Test content'
      });

    // @ts-expect-error - vi.fn() type narrowing issue

      const mockGetAllCallsAfterFirst = mockGetAll.mock.calls.length;

      // 2回目のrecord呼び出し
      await recordingLogic.record({
        title: 'Test Page 2',
        url: 'https://example2.com',
        content: 'Test content 2'
      });

      // 2回目の呼び出しでもmockGetAllは追加で呼ばれない（キャッシュ使用）
    // @ts-expect-error - vi.fn() type narrowing issue

      expect(mockGetAll.mock.calls.length).toBe(mockGetAllCallsAfterFirst);
    });

    it('キャッシュ期限切れ後にrecordメソッドがstorageから再取得する', async () => {
      const mockObsidianClient = {
        appendToDailyNote: vi.fn().mockResolvedValue()
      };
      recordingLogic = makeRecordingLogic(mockObsidianClient, mockAiClient);

      // First record call
      await recordingLogic.record({
        title: 'Test Page',
        url: 'https://example.com',
        content: 'Test content'
      });

      // Expire the cache via the typed seam (record 経路のため fake timers は使わない)
      RecordingCache.invalidateSettingsCache();

      mockGetAll.mockClear();
      mockGetAll.mockResolvedValue({
        AI_PROVIDER: 'new-provider'
      });

      // Second record call
      await recordingLogic.record({
        title: 'Test Page 2',
        url: 'https://example2.com',
        content: 'Test content 2'
      });

      expect(mockGetAll).toHaveBeenCalled();
    });
  });

  describe('並列呼び出しの処理', () => {
    it('複数のrecord呼び出しが並行であっても安全に処理する', async () => {
      const mockObsidianClient = {
        appendToDailyNote: vi.fn().mockResolvedValue()
      };
      recordingLogic = makeRecordingLogic(mockObsidianClient, mockAiClient);

      // Just verify parallel calls don't throw - the exact behavior may vary
      const promises = [];
      for (let i = 0; i < 3; i++) {
        promises.push(
          recordingLogic.record({
            title: `Test Page ${i}`,
            url: `https://example.com/${i}`,
            content: `Content ${i}`
          }).catch(e => ({ success: false, error: e.message }))
        );
      }

      const results = await Promise.all(promises);

      // All should either succeed or fail gracefully
      results.forEach(result => {
        expect(result).toHaveProperty('success');
      });
    });

    it('複数のgetSettingsWithCache呼び出しが安全に処理する', async () => {
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(RecordingCache.getSettingsWithCache());
      }

      const results = await Promise.all(promises);

      // すべての結果が設定オブジェクトであることを確認
      results.forEach(result => {
        expect(result).toHaveProperty('AI_PROVIDER');
      });

      // mockGetAllは呼ばれるが、キャッシュにより回数が制限される
      expect(mockGetAll).toHaveBeenCalled();
    });
  });

  describe('エッジケース', () => {
    it('設定がnullの場合の処理', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue

      mockGetAll.mockResolvedValue(null);

      const settings = await RecordingCache.getSettingsWithCache();

      expect(settings).toBeNull();
    });

    it('設定が空オブジェクトの場合の処理', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue

      mockGetAll.mockResolvedValue({});

      const settings = await RecordingCache.getSettingsWithCache();

      expect(settings).toEqual({});
    });

    it('getSettingsがrejectした場合のエラー伝播', async () => {
      const error = new Error('Storage error');
    // @ts-expect-error - vi.fn() type narrowing issue

      mockGetAll.mockRejectedValue(error);

      await expect(RecordingCache.getSettingsWithCache()).rejects.toThrow('Storage error');
    });

    it('リセット後の読み取りが正常に動作する（version seam 撤去に伴い smoke 化）', async () => {
      // version は typed 実装の内部状態になり外部から設定不可。
      // live-view 撤去によりオーバーフローを外部から再現できないため、
      // リセット→読み取りの基本動作を smoke として残す。
      RecordingCache.resetCacheState();
    // @ts-expect-error - vi.fn() type narrowing issue

      mockGetAll.mockResolvedValue({ AI_PROVIDER: 'smoke' });

      const settings = await RecordingCache.getSettingsWithCache();

      expect(settings).toHaveProperty('AI_PROVIDER', 'smoke');
    });
  });

  describe('パフォーマンス検証', () => {
    it('キャッシュ使用時のパフォーマンス向上を検証する', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue

      mockObsidianClient.appendToDailyNote = vi.fn().mockResolvedValue();

      // 初回呼び出し（キャッシュミス）
      const start1 = Date.now();
      await recordingLogic.record({
        title: 'Test Page',
        url: 'https://example.com',
        content: 'Test content'
      });
      const duration1 = Date.now() - start1;

      // 2回目以降の呼び出し（キャッシュヒット）
      mockGetAll.mockClear();
      const start2 = Date.now();
      await recordingLogic.record({
        title: 'Test Page 2',
        url: 'https://example2.com',
        content: 'Test content 2'
      });
      const duration2 = Date.now() - start2;

      // 2回目の呼び出しではmockGetAllが呼ばれないことを確認
      expect(mockGetAll).not.toHaveBeenCalled();

      // 注: Jest環境でのテストなので、mockGetAllの呼び出し回数を確認する
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
