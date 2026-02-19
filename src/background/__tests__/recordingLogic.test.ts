// src/background/__tests__/recordingLogic.test.js
import { RecordingLogic } from '../recordingLogic.js';
import * as storage from '../../utils/storage.js';
import * as domainUtils from '../../utils/domainUtils.js';
import * as privacy from '../privacyPipeline.js';

jest.mock('../../utils/storage.js');
jest.mock('../../utils/domainUtils.js');
jest.mock('../privacyPipeline.js');

describe('RecordingLogic', () => {
  const mockObsidian = {
    appendToDailyNote: jest.fn()
  };

  const mockAiClient = {
    // @ts-expect-error - jest.fn() type narrowing issue
  
    getLocalAvailability: jest.fn().mockResolvedValue('readily'),
    // @ts-expect-error - jest.fn() type narrowing issue
  
    summarizeLocally: jest.fn().mockResolvedValue({ success: true, summary: 'test' }),
    // @ts-expect-error - jest.fn() type narrowing issue
  
    generateSummary: jest.fn().mockResolvedValue('Cloud summary')
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Chrome notifications APIが存在する場合のみモック
    if (!chrome.notifications) {
      chrome.notifications = { create: jest.fn() };
    }

    // Problem #7: URLキャッシュを初期化
    RecordingLogic.cacheState = {
      settingsCache: null,
      cacheTimestamp: null,
      cacheVersion: 0,
      urlCache: null,
      urlCacheTimestamp: null,
      privacyCache: null,
      privacyCacheTimestamp: null
    };

    // storageのデフォルトモック
    // @ts-expect-error - jest.fn() type narrowing issue
  
    storage.getSettings.mockResolvedValue({ PRIVACY_MODE: 'full_pipeline', PII_SANITIZE_LOGS: true });
    // @ts-expect-error - jest.fn() type narrowing issue
  
    storage.getSavedUrlsWithTimestamps.mockResolvedValue(new Map());
    // @ts-expect-error - jest.fn() type narrowing issue
  
    storage.setSavedUrlsWithTimestamps.mockResolvedValue();
    storage.StorageKeys = {
      PRIVACY_MODE: 'PRIVACY_MODE',
      PII_SANITIZE_LOGS: 'PII_SANITIZE_LOGS'
    };
    // domainUtilsのデフォルトモック
    // @ts-expect-error - jest.fn() type narrowing issue
  
    domainUtils.isDomainAllowed.mockResolvedValue(true);
    // PrivacyPipelineのデフォルトモック
    // @ts-expect-error - jest.fn() type narrowing issue
  
    privacy.PrivacyPipeline.mockImplementation(() => ({
    // @ts-expect-error - jest.fn() type narrowing issue
  
      process: jest.fn().mockResolvedValue({ summary: 'Test summary', maskedCount: 0 })
    }));
  });

  describe('record', () => {
    it('should skip recording when domain is not allowed', async () => {
      const logic = new RecordingLogic(mockObsidian, mockAiClient);
    // @ts-expect-error - jest.fn() type narrowing issue
  
      domainUtils.isDomainAllowed.mockResolvedValue(false);

      const result = await logic.record({
        url: 'https://blocked.com',
        title: 'Blocked',
        content: 'Content'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('DOMAIN_BLOCKED');
    });

    it('should skip recording when URL is already saved', async () => {
      const logic = new RecordingLogic(mockObsidian, mockAiClient);
    // @ts-expect-error - jest.fn() type narrowing issue
  
      storage.getSavedUrlsWithTimestamps.mockResolvedValue(new Map([['https://test.com', Date.now()]]));

      const result = await logic.record({
        url: 'https://test.com',
        title: 'Test',
        content: 'Content'
      });

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
    });

    it('should truncate extremely large content to 64KB', async () => {
      // 🟢 信頼性レベル: 直接実装（RecordingLogic.js 130行目）を参照
      const logic = new RecordingLogic(mockObsidian, mockAiClient);
      const largeContent = 'a'.repeat(100 * 1024); // 100KB
      const expectedLimit = 64 * 1024;

      const mockPipeline = {
    // @ts-expect-error - jest.fn() type narrowing issue
  
        process: jest.fn().mockResolvedValue({ summary: 'Summary', maskedCount: 0 })
      };
    // @ts-expect-error - jest.fn() type narrowing issue
  
      privacy.PrivacyPipeline.mockImplementation(() => mockPipeline);

      await logic.record({
        url: 'https://large-page.com',
        title: 'Large Page',
        content: largeContent
      });

      // PrivacyPipelineに渡されるコンテンツが64KBに切り詰められていることを確認
      expect(mockPipeline.process).toHaveBeenCalledWith(
        largeContent.substring(0, expectedLimit),
        expect.any(Object)
      );
    });
  });

  describe('Privacy Cache', () => {
    beforeEach(() => {
      // キャッシュをクリア
      RecordingLogic.invalidatePrivacyCache();
    });

    test('getPrivacyInfoWithCache - キャッシュヒット時にPrivacyInfoを返す', async () => {
      const url = 'https://example.com/private';
      const mockInfo = {
        isPrivate: true,
        reason: 'cache-control' as const,
        timestamp: Date.now()
      };

      // キャッシュに手動で追加
      RecordingLogic.cacheState.privacyCache = new Map([[url, mockInfo]]);
      RecordingLogic.cacheState.privacyCacheTimestamp = Date.now();

      const obsidian = {} as any;
      const aiClient = {} as any;
      const logic = new RecordingLogic(obsidian, aiClient);

      const result = await logic.getPrivacyInfoWithCache(url);

      expect(result).toEqual(mockInfo);
    });

    test('getPrivacyInfoWithCache - キャッシュミス時にnullを返す', async () => {
      const url = 'https://example.com/unknown';

      RecordingLogic.cacheState.privacyCache = new Map();

      const obsidian = {} as any;
      const aiClient = {} as any;
      const logic = new RecordingLogic(obsidian, aiClient);

      const result = await logic.getPrivacyInfoWithCache(url);

      expect(result).toBeNull();
    });

    test('getPrivacyInfoWithCache - TTL期限切れ時にnullを返す', async () => {
      const url = 'https://example.com/expired';
      const oldTimestamp = Date.now() - 6 * 60 * 1000; // 6分前
      const mockInfo = {
        isPrivate: true,
        reason: 'cache-control' as const,
        timestamp: oldTimestamp
      };

      RecordingLogic.cacheState.privacyCache = new Map([[url, mockInfo]]);
      RecordingLogic.cacheState.privacyCacheTimestamp = oldTimestamp;

      const obsidian = {} as any;
      const aiClient = {} as any;
      const logic = new RecordingLogic(obsidian, aiClient);

      const result = await logic.getPrivacyInfoWithCache(url);

      expect(result).toBeNull();
    });

    test('invalidatePrivacyCache - キャッシュを無効化できる', () => {
      RecordingLogic.cacheState.privacyCache = new Map([['test', {} as any]]);
      RecordingLogic.cacheState.privacyCacheTimestamp = Date.now();

      RecordingLogic.invalidatePrivacyCache();

      expect(RecordingLogic.cacheState.privacyCache).toBeNull();
      expect(RecordingLogic.cacheState.privacyCacheTimestamp).toBeNull();
    });
  });
});