// src/background/__tests__/recordingLogic-whitelist-bypass.test.ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { RecordingLogic } from '../recordingLogic.js';
import type { ObsidianClient } from '../obsidianClient.js';
import type { AIClient } from '../aiClient.js';
import { StorageKeys } from '../../utils/storage.js';
import type { Settings } from '../../utils/storage.js';

// モック設定
jest.mock('../../utils/storage.js');
jest.mock('../../utils/domainUtils.js');

describe('RecordingLogic - Whitelist Privacy Bypass', () => {
  let recordingLogic: RecordingLogic;
  let mockObsidian: ObsidianClient;
  let mockAIClient: AIClient;

  beforeEach(() => {
    jest.clearAllMocks();
    // キャッシュクリア
    RecordingLogic.invalidateSettingsCache();
    RecordingLogic.invalidatePrivacyCache();
    RecordingLogic.invalidateUrlCache();

    // モッククライアント作成
    mockObsidian = {
      appendToDailyNote: jest.fn().mockResolvedValue(undefined)
    } as any;

    mockAIClient = {
      // @ts-expect-error - jest.fn() type narrowing issue
      getLocalAvailability: jest.fn().mockResolvedValue('readily'),
      // @ts-expect-error - jest.fn() type narrowing issue
      summarizeLocally: jest.fn().mockResolvedValue({ success: true, summary: 'test' }),
      // @ts-expect-error - jest.fn() type narrowing issue
      generateSummary: jest.fn().mockResolvedValue('Test summary')
    } as any;

    recordingLogic = new RecordingLogic(mockObsidian, mockAIClient);

    // storageのデフォルトモック
    const { getSettings, getSavedUrlsWithTimestamps } = require('../../utils/storage.js');
    // @ts-expect-error - jest.fn() type narrowing issue
    getSettings.mockResolvedValue({
      [StorageKeys.DOMAIN_WHITELIST]: [],
      PRIVACY_MODE: 'full_pipeline',
      PII_SANITIZE_LOGS: true,
      [StorageKeys.OBSIDIAN_DAILY_PATH]: 'Daily/{{date}}.md'
    });
    // @ts-expect-error - jest.fn() type narrowing issue
    getSavedUrlsWithTimestamps.mockResolvedValue(new Map());

    // domainUtilsのデフォルトモック
    const { isDomainAllowed } = require('../../utils/domainUtils.js');
    // @ts-expect-error - jest.fn() type narrowing issue
    isDomainAllowed.mockResolvedValue(true);
  });

  it('should bypass privacy check for whitelisted domain', async () => {
    // このテストは後で実装
  });
});