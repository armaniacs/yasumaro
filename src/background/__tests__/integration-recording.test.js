// src/background/__tests__/integration-recording.test.js
import { RecordingLogic } from '../recordingLogic.js';

import * as storage from '../../utils/storage.js';
import * as domainUtils from '../../utils/domainUtils.js';
import * as privacy from '../privacyPipeline.js';

jest.mock('../../utils/storage.js');
jest.mock('../../utils/domainUtils.js');
jest.mock('../privacyPipeline.js');

// Chrome notifications mock
beforeEach(() => {
  jest.clearAllMocks();
  if (!chrome.notifications) {
    chrome.notifications = { create: jest.fn() };
  }
  // storageのデフォルトモック
  storage.getSettings.mockResolvedValue({
    PRIVACY_MODE: 'full_pipeline',
    PII_SANITIZE_LOGS: true
  });
  storage.getSavedUrlsWithTimestamps.mockResolvedValue(new Map());
  storage.setSavedUrlsWithTimestamps.mockResolvedValue();

  // Problem #7: URLキャッシュを初期化
  RecordingLogic.cacheState = {
    settingsCache: null,
    cacheTimestamp: null,
    cacheVersion: 0,
    urlCache: null,
    urlCacheTimestamp: null
  };

  storage.StorageKeys = {
    PRIVACY_MODE: 'PRIVACY_MODE',
    PII_SANITIZE_LOGS: 'PII_SANITIZE_LOGS'
  };
  // domainUtilsのデフォルトモック
  domainUtils.isDomainAllowed.mockResolvedValue(true);
  // PrivacyPipelineのデフォルトモック
  privacy.PrivacyPipeline.mockImplementation(() => ({
    process: jest.fn().mockImplementation(async (content, options) => {
      if (options && options.previewOnly) {
        return {
          success: true,
          preview: true,
          processedContent: 'Processed content',
          mode: 'full_pipeline',
          maskedCount: 1
        };
      }
      return { summary: 'Test summary', maskedCount: 0 };
    })
  }));
});

describe('Recording Integration Test', () => {
  let mockObsidian, mockAiClient, logic;

  beforeEach(() => {
    mockObsidian = {
      appendToDailyNote: jest.fn().mockResolvedValue()
    };

    mockAiClient = {
      getLocalAvailability: jest.fn().mockResolvedValue('readily'),
      summarizeLocally: jest.fn().mockResolvedValue({ success: true, summary: 'Local summary' }),
      generateSummary: jest.fn().mockResolvedValue('Cloud summary')
    };

    logic = new RecordingLogic(mockObsidian, mockAiClient);
  });

  it('should successfully record a URL through full pipeline', async () => {
    const result = await logic.record({
      url: 'https://example.com',
      title: 'Example',
      content: 'Test content'
    });

    expect(result.success).toBe(true);
    expect(mockObsidian.appendToDailyNote).toHaveBeenCalled();
    expect(storage.setSavedUrlsWithTimestamps).toHaveBeenCalled();
    expect(chrome.notifications.create).toHaveBeenCalled();
  });

  it('should handle force recording for blocked domains', async () => {
    domainUtils.isDomainAllowed.mockResolvedValue(false);

    const result = await logic.record({
      url: 'https://blocked.com',
      title: 'Blocked',
      content: 'Test content',
      force: true
    });

    expect(result.success).toBe(true);
    expect(mockObsidian.appendToDailyNote).toHaveBeenCalled();
  });

  it('should return preview data for previewOnly mode', async () => {
    const result = await logic.record({
      url: 'https://example.com',
      title: 'Example',
      content: 'Test content',
      previewOnly: true
    });

    expect(result.preview).toBe(true);
    expect(result.processedContent).toBeDefined();
    expect(mockObsidian.appendToDailyNote).not.toHaveBeenCalled();
  });

  it('should handle recording errors gracefully', async () => {
    mockObsidian.appendToDailyNote.mockRejectedValue(new Error('Connection failed'));

    const result = await logic.record({
      url: 'https://example.com',
      title: 'Example',
      content: 'Test content'
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Connection failed');
    expect(chrome.notifications.create).toHaveBeenCalled();
  });
});