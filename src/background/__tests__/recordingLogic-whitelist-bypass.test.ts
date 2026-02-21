// src/background/__tests__/recordingLogic-whitelist-bypass.test.ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { RecordingLogic } from '../recordingLogic.js';
import type { ObsidianClient } from '../obsidianClient.js';
import type { AIClient } from '../aiClient.js';
import { StorageKeys } from '../../utils/storage.js';
import type { Settings } from '../../utils/storage.js';
import * as privacy from '../privacyPipeline.js';

// モック設定
jest.mock('../../utils/storage.js');
jest.mock('../../utils/domainUtils.js');
jest.mock('../privacyPipeline.js');

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

    // PrivacyPipelineのモック
    // @ts-expect-error - jest.fn() type narrowing issue
    privacy.PrivacyPipeline.mockImplementation(() => ({
      // @ts-expect-error - jest.fn() type narrowing issue
      process: jest.fn().mockResolvedValue({ summary: 'Test summary', maskedCount: 0 })
    }));

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
    const { isDomainAllowed, extractDomain, isDomainInList } = require('../../utils/domainUtils.js');
    // @ts-expect-error - jest.fn() type narrowing issue
    isDomainAllowed.mockResolvedValue(true);
    // @ts-expect-error - jest.fn() type narrowing issue
    extractDomain.mockImplementation((url: string) => {
      try {
        const urlObj = new URL(url);
        return urlObj.hostname.replace(/^www\./, '');
      } catch {
        return null;
      }
    });
    // @ts-expect-error - jest.fn() type narrowing issue
    isDomainInList.mockImplementation((domain: string, list: string[]) => {
      if (!domain || !list || list.length === 0) return false;
      return list.some(pattern => {
        if (pattern.includes('*')) {
          const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regexPattern = escaped.replace(/\\\*/g, '.*');
          const regex = new RegExp(`^${regexPattern}$`, 'i');
          return regex.test(domain);
        }
        return domain.toLowerCase() === pattern.toLowerCase();
      });
    });
  });

  it('should bypass privacy check for whitelisted domain', async () => {
    // モック設定: ホワイトリストにconfluence.example.comを登録
    const mockSettings: Partial<Settings> = {
      [StorageKeys.DOMAIN_WHITELIST]: ['confluence.example.com'],
      PRIVACY_MODE: 'masked_cloud',
      [StorageKeys.OBSIDIAN_DAILY_PATH]: 'Daily/{{date}}.md'
    };

    const { getSettings } = require('../../utils/storage.js');
    // @ts-expect-error - jest.fn() type narrowing issue
    getSettings.mockResolvedValue(mockSettings);

    // プライバシーキャッシュ: isPrivate=true をセット
    const privacyInfo = {
      isPrivate: true,
      reason: 'cache-control' as const,
      timestamp: Date.now()
    };
    RecordingLogic.cacheState.privacyCache = new Map();
    RecordingLogic.cacheState.privacyCache.set('https://confluence.example.com/page', privacyInfo);

    // ドメインフィルター: 許可
    const { isDomainAllowed } = require('../../utils/domainUtils.js');
    // @ts-expect-error - jest.fn() type narrowing issue
    isDomainAllowed.mockResolvedValue(true);

    // URLキャッシュを空に設定
    const { getSavedUrlsWithTimestamps } = require('../../utils/storage.js');
    // @ts-expect-error - jest.fn() type narrowing issue
    getSavedUrlsWithTimestamps.mockResolvedValue(new Map());

    // テスト実行
    const result = await recordingLogic.record({
      title: 'Test Page',
      url: 'https://confluence.example.com/page',
      content: 'Test content',
      force: false
    });

    // 検証: 成功すること（プライバシーチェックがバイパスされる）
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(mockObsidian.appendToDailyNote).toHaveBeenCalled();
  });

  it('should perform normal privacy check for non-whitelisted domain', async () => {
    // モック設定: ホワイトリストにconfluence.example.comのみ登録
    const mockSettings: Partial<Settings> = {
      [StorageKeys.DOMAIN_WHITELIST]: ['confluence.example.com'],
      PRIVACY_MODE: 'masked_cloud',
      [StorageKeys.OBSIDIAN_DAILY_PATH]: 'Daily/{{date}}.md'
    };

    const { getSettings } = require('../../utils/storage.js');
    // @ts-expect-error - jest.fn() type narrowing issue
    getSettings.mockResolvedValue(mockSettings);

    // プライバシーキャッシュ: isPrivate=true をセット
    const privacyInfo = {
      isPrivate: true,
      reason: 'cache-control' as const,
      timestamp: Date.now()
    };
    RecordingLogic.cacheState.privacyCache = new Map();
    RecordingLogic.cacheState.privacyCache.set('https://bank.example.com/page', privacyInfo);

    // ドメインフィルター: 許可
    const { isDomainAllowed } = require('../../utils/domainUtils.js');
    // @ts-expect-error - jest.fn() type narrowing issue
    isDomainAllowed.mockResolvedValue(true);

    // テスト実行（非ホワイトリストドメイン）
    const result = await recordingLogic.record({
      title: 'Bank Page',
      url: 'https://bank.example.com/page',
      content: 'Test content',
      force: false
    });

    // 検証: PRIVATE_PAGE_DETECTEDエラーが返ること
    expect(result.success).toBe(false);
    expect(result.error).toBe('PRIVATE_PAGE_DETECTED');
    expect(result.reason).toBe('cache-control');
    expect(mockObsidian.appendToDailyNote).not.toHaveBeenCalled();
  });

  it('should support wildcard pattern in whitelist', async () => {
    // モック設定: ワイルドカードパターンをホワイトリストに登録
    const mockSettings: Partial<Settings> = {
      [StorageKeys.DOMAIN_WHITELIST]: ['*.confluence.example.com'],
      PRIVACY_MODE: 'masked_cloud',
      [StorageKeys.OBSIDIAN_DAILY_PATH]: 'Daily/{{date}}.md'
    };

    const { getSettings } = require('../../utils/storage.js');
    // @ts-expect-error - jest.fn() type narrowing issue
    getSettings.mockResolvedValue(mockSettings);

    // プライバシーキャッシュ: isPrivate=true をセット
    const privacyInfo = {
      isPrivate: true,
      reason: 'set-cookie' as const,
      timestamp: Date.now()
    };
    RecordingLogic.cacheState.privacyCache = new Map();
    RecordingLogic.cacheState.privacyCache.set('https://wiki.confluence.example.com/page', privacyInfo);

    // ドメインフィルター: 許可
    const { isDomainAllowed } = require('../../utils/domainUtils.js');
    // @ts-expect-error - jest.fn() type narrowing issue
    isDomainAllowed.mockResolvedValue(true);

    // URLキャッシュを空に設定
    const { getSavedUrlsWithTimestamps } = require('../../utils/storage.js');
    // @ts-expect-error - jest.fn() type narrowing issue
    getSavedUrlsWithTimestamps.mockResolvedValue(new Map());

    // テスト実行（サブドメイン）
    const result = await recordingLogic.record({
      title: 'Wiki Page',
      url: 'https://wiki.confluence.example.com/page',
      content: 'Test content',
      force: false
    });

    // 検証: 成功すること（ワイルドカードマッチでバイパス）
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(mockObsidian.appendToDailyNote).toHaveBeenCalled();
  });

  it('should perform privacy check when whitelist is empty', async () => {
    // モック設定: 空のホワイトリスト
    const mockSettings: Partial<Settings> = {
      [StorageKeys.DOMAIN_WHITELIST]: [],
      PRIVACY_MODE: 'masked_cloud',
      [StorageKeys.OBSIDIAN_DAILY_PATH]: 'Daily/{{date}}.md'
    };

    const { getSettings } = require('../../utils/storage.js');
    // @ts-expect-error - jest.fn() type narrowing issue
    getSettings.mockResolvedValue(mockSettings);

    // プライバシーキャッシュ: isPrivate=true をセット
    const privacyInfo = {
      isPrivate: true,
      reason: 'authorization' as const,
      timestamp: Date.now()
    };
    RecordingLogic.cacheState.privacyCache = new Map();
    RecordingLogic.cacheState.privacyCache.set('https://example.com/page', privacyInfo);

    // ドメインフィルター: 許可
    const { isDomainAllowed } = require('../../utils/domainUtils.js');
    // @ts-expect-error - jest.fn() type narrowing issue
    isDomainAllowed.mockResolvedValue(true);

    // テスト実行
    const result = await recordingLogic.record({
      title: 'Test Page',
      url: 'https://example.com/page',
      content: 'Test content',
      force: false
    });

    // 検証: PRIVATE_PAGE_DETECTEDエラーが返ること
    expect(result.success).toBe(false);
    expect(result.error).toBe('PRIVATE_PAGE_DETECTED');
    expect(mockObsidian.appendToDailyNote).not.toHaveBeenCalled();
  });

  it('should fallback to privacy check on URL parse error', async () => {
    // モック設定: ホワイトリストあり
    const mockSettings: Partial<Settings> = {
      [StorageKeys.DOMAIN_WHITELIST]: ['example.com'],
      PRIVACY_MODE: 'masked_cloud',
      [StorageKeys.OBSIDIAN_DAILY_PATH]: 'Daily/{{date}}.md'
    };

    const { getSettings } = require('../../utils/storage.js');
    // @ts-expect-error - jest.fn() type narrowing issue
    getSettings.mockResolvedValue(mockSettings);

    // プライバシーキャッシュ: isPrivate=true をセット（不正なURLでもキャッシュキーとして使える）
    const privacyInfo = {
      isPrivate: true,
      reason: 'cache-control' as const,
      timestamp: Date.now()
    };
    RecordingLogic.cacheState.privacyCache = new Map();
    RecordingLogic.cacheState.privacyCache.set('invalid-url', privacyInfo);

    // ドメインフィルター: 許可
    const { isDomainAllowed } = require('../../utils/domainUtils.js');
    // @ts-expect-error - jest.fn() type narrowing issue
    isDomainAllowed.mockResolvedValue(true);

    // テスト実行（不正なURL）
    const result = await recordingLogic.record({
      title: 'Invalid URL',
      url: 'invalid-url',
      content: 'Test content',
      force: false
    });

    // 検証: PRIVATE_PAGE_DETECTEDエラーが返ること（URLパースエラー時はプライバシーチェックにフォールバック）
    expect(result.success).toBe(false);
    expect(result.error).toBe('PRIVATE_PAGE_DETECTED');
    expect(mockObsidian.appendToDailyNote).not.toHaveBeenCalled();
  });
});