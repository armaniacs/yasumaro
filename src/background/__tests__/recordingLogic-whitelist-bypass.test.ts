// src/background/__tests__/recordingLogic-whitelist-bypass.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RecordingLogic } from '../recordingLogic.js';
import type { ObsidianClient } from '../obsidianClient.js';
import type { AIClient } from '../aiClient.js';
import { StorageKeys } from '../../utils/storage.js';
import type { Settings } from '../../utils/storage.js';
import * as privacy from '../privacyPipeline.js';
import * as storageModule from '../../utils/storage.js';
import * as domainUtilsModule from '../../utils/domainUtils.js';

// モック設定
vi.mock('../../utils/storage.js');
vi.mock('../../utils/domainUtils.js');
vi.mock('../privacyPipeline.js');

describe('RecordingLogic - Whitelist Privacy Bypass', () => {
  let recordingLogic: RecordingLogic;
  let mockObsidian: ObsidianClient;
  let mockAIClient: AIClient;
  let getSettings: any;
  let getSavedUrlsWithTimestamps: any;
  let isDomainAllowed: any;

  beforeEach(() => {
    vi.clearAllMocks();
    // キャッシュクリア
    RecordingLogic.invalidateSettingsCache();
    RecordingLogic.invalidatePrivacyCache();
    RecordingLogic.invalidateUrlCache();

    // PrivacyPipelineのモック - use function() for constructor compatibility
    // @ts-expect-error - vi.fn() type narrowing issue
    privacy.PrivacyPipeline.mockImplementation(function(this: any) {
      this.process = vi.fn().mockResolvedValue({ summary: 'Test summary', maskedCount: 0 });
    });

    // モッククライアント作成
    mockObsidian = {
      appendToDailyNote: vi.fn().mockResolvedValue(undefined)
    } as any;

    mockAIClient = {
      // @ts-expect-error - vi.fn() type narrowing issue
      getSupportedModes: vi.fn().mockReturnValue(['local_only', 'full_pipeline']),
      // @ts-expect-error - vi.fn() type narrowing issue
      generateSummary: vi.fn().mockResolvedValue({ summary: 'Test summary' })
    } as any;

    recordingLogic = new RecordingLogic(mockObsidian, mockAIClient);

    // storageのデフォルトモック
    const storageMocked = vi.mocked(storageModule);
    getSettings = storageMocked.getSettings;
    getSavedUrlsWithTimestamps = storageMocked.getSavedUrlsWithTimestamps;
    // @ts-expect-error - vi.fn() type narrowing issue
    getSettings.mockResolvedValue({
      [StorageKeys.DOMAIN_WHITELIST]: [],
      [StorageKeys.PRIVACY_MODE]: 'full_pipeline',
      [StorageKeys.PII_SANITIZE_LOGS]: true,
      'auto_save_privacy_behavior': 'skip',
      [StorageKeys.OBSIDIAN_DAILY_PATH]: 'Daily/{{date}}.md'
    });
    // @ts-expect-error - vi.fn() type narrowing issue
    getSavedUrlsWithTimestamps.mockResolvedValue(new Map());

    // domainUtilsのデフォルトモック
    const domainMocked = vi.mocked(domainUtilsModule);
    isDomainAllowed = domainMocked.isDomainAllowed;
    const extractDomain = domainMocked.extractDomain;
    const isDomainInList = domainMocked.isDomainInList;
    // @ts-expect-error - vi.fn() type narrowing issue
    isDomainAllowed.mockResolvedValue(true);
    // @ts-expect-error - vi.fn() type narrowing issue
    extractDomain.mockImplementation((url: string) => {
      try {
        const urlObj = new URL(url);
        return urlObj.hostname.replace(/^www\./, '');
      } catch {
        return null;
      }
    });
    // @ts-expect-error - vi.fn() type narrowing issue
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

  it('should block private page for non-whitelisted domain', async () => {
    const mockSettings: Partial<Settings> = {
      [StorageKeys.DOMAIN_WHITELIST]: ['confluence.example.com'],
      PRIVACY_MODE: 'masked_cloud',
      'auto_save_privacy_behavior': 'skip',
      [StorageKeys.OBSIDIAN_DAILY_PATH]: 'Daily/{{date}}.md'
    };

    getSettings.mockResolvedValue(mockSettings);

    const privacyInfo = {
      isPrivate: true,
      reason: 'cache-control' as const,
      timestamp: Date.now()
    };
    RecordingLogic.cacheState.privacyCache = new Map();
    RecordingLogic.cacheState.privacyCache.set('https://bank.example.com/page', privacyInfo);

    isDomainAllowed.mockResolvedValue(true);

    const result = await recordingLogic.record({
      title: 'Bank Page',
      url: 'https://bank.example.com/page',
      content: 'Test content',
      force: false
    });

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
    // @ts-expect-error - vi.fn() type narrowing issue
    isDomainAllowed.mockResolvedValue(true);

    // URLキャッシュを空に設定
    // @ts-expect-error - vi.fn() type narrowing issue
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
      [StorageKeys.PRIVACY_MODE]: 'masked_cloud',
      'auto_save_privacy_behavior': 'skip',
      [StorageKeys.OBSIDIAN_DAILY_PATH]: 'Daily/{{date}}.md'
    };

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
    // @ts-expect-error - vi.fn() type narrowing issue
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

  it('should return invalid URL error on URL parse error', async () => {
    // モック設定: ホワイトリストあり
    const mockSettings: Partial<Settings> = {
      [StorageKeys.DOMAIN_WHITELIST]: ['example.com'],
      [StorageKeys.PRIVACY_MODE]: 'masked_cloud',
      'auto_save_privacy_behavior': 'skip',
      [StorageKeys.OBSIDIAN_DAILY_PATH]: 'Daily/{{date}}.md'
    };

    getSettings.mockResolvedValue(mockSettings);

    // ドメインフィルター: 許可
    // @ts-expect-error - vi.fn() type narrowing issue
    isDomainAllowed.mockResolvedValue(true);

    // テスト実行（不正なURL）
    const result = await recordingLogic.record({
      title: 'Invalid URL',
      url: 'invalid-url',
      content: 'Test content',
      force: false
    });

    // 検証: INVALID_URLエラーが返ること
    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_URL');
    expect(mockObsidian.appendToDailyNote).not.toHaveBeenCalled();
  });
});