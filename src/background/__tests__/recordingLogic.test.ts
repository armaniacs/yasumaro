// src/background/__tests__/recordingLogic.test.js
import { RecordingLogic } from '../recordingLogic.ts';
import * as storage from '../../utils/storage.ts';
import * as domainUtils from '../../utils/domainUtils.ts';
import * as privacy from '../privacyPipeline.ts';

jest.mock('../../utils/storage.ts');
jest.mock('../../utils/domainUtils.ts');
jest.mock('../privacyPipeline.ts');

describe('RecordingLogic', () => {
  const mockObsidian = {
    appendToDailyNote: jest.fn()
  };

  const mockAiClient = {
    getLocalAvailability: jest.fn().mockResolvedValue('readily'),
    summarizeLocally: jest.fn().mockResolvedValue({ success: true, summary: 'test' }),
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
      urlCacheTimestamp: null
    };

    // storageのデフォルトモック
    storage.getSettings.mockResolvedValue({ PRIVACY_MODE: 'full_pipeline', PII_SANITIZE_LOGS: true });
    storage.getSavedUrlsWithTimestamps.mockResolvedValue(new Map());
    storage.setSavedUrlsWithTimestamps.mockResolvedValue();
    storage.StorageKeys = {
      PRIVACY_MODE: 'PRIVACY_MODE',
      PII_SANITIZE_LOGS: 'PII_SANITIZE_LOGS'
    };
    // domainUtilsのデフォルトモック
    domainUtils.isDomainAllowed.mockResolvedValue(true);
    // PrivacyPipelineのデフォルトモック
    privacy.PrivacyPipeline.mockImplementation(() => ({
      process: jest.fn().mockResolvedValue({ summary: 'Test summary', maskedCount: 0 })
    }));
  });

  describe('record', () => {
    it('should skip recording when domain is not allowed', async () => {
      const logic = new RecordingLogic(mockObsidian, mockAiClient);
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
        process: jest.fn().mockResolvedValue({ summary: 'Summary', maskedCount: 0 })
      };
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
});