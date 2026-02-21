// src/background/__tests__/recordingLogic.test.ts
import { RecordingLogic } from '../recordingLogic.js';
import * as storage from '../../utils/storage.js';
import * as domainUtils from '../../utils/domainUtils.js';
import * as privacy from '../privacyPipeline.js';
import * as pendingStorage from '../../utils/pendingStorage.js';
import type { PrivacyInfo } from '../../utils/privacyChecker.js';

jest.mock('../../utils/storage.js');
jest.mock('../../utils/domainUtils.js');
jest.mock('../privacyPipeline.js');
jest.mock('../../utils/pendingStorage.js');

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

  describe('Privacy Check Integration', () => {
    beforeEach(() => {
      RecordingLogic.invalidatePrivacyCache();
      // 既存のmock setup
      jest.clearAllMocks();
      if (!chrome.notifications) {
        chrome.notifications = { create: jest.fn() };
      }

      RecordingLogic.cacheState = {
        settingsCache: null,
        cacheTimestamp: null,
        cacheVersion: 0,
        urlCache: null,
        urlCacheTimestamp: null,
        privacyCache: null,
        privacyCacheTimestamp: null
      };

      // @ts-expect-error - jest.fn() type narrowing issue
      storage.getSettings.mockResolvedValue({ PRIVACY_MODE: 'full_pipeline', PII_SANITIZE_LOGS: true });
      // @ts-expect-error - jest.fn() type narrowing issue
      storage.getSavedUrlsWithTimestamps.mockResolvedValue(new Map());
      // @ts-expect-error - jest.fn() type narrowing issue
      storage.setSavedUrlsWithTimestamps.mockResolvedValue();
      // @ts-expect-error - jest.fn() type narrowing issue
      domainUtils.isDomainAllowed.mockResolvedValue(true);
      // @ts-expect-error - jest.fn() type narrowing issue
      privacy.PrivacyPipeline.mockImplementation(() => ({
        // @ts-expect-error - jest.fn() type narrowing issue
        process: jest.fn().mockResolvedValue({ summary: 'Test summary', maskedCount: 0 })
      }));
    });

    test('プライベートページの場合 PRIVATE_PAGE_DETECTED エラーを返す', async () => {
      const url = 'https://example.com/private';
      const mockPrivacyInfo = {
        isPrivate: true,
        reason: 'cache-control' as const,
        timestamp: Date.now()
      };

      // キャッシュに追加
      RecordingLogic.cacheState.privacyCache = new Map([[url, mockPrivacyInfo]]);

      const mockObsidian = { appendToDailyNote: jest.fn() } as any;
      const mockAiClient = {} as any;
      const logic = new RecordingLogic(mockObsidian, mockAiClient);

      const result = await logic.record({
        title: 'Test',
        url,
        content: 'content'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('PRIVATE_PAGE_DETECTED');
      expect(result.reason).toBe('cache-control');
    });

    test('force=true の場合はプライバシーチェックをスキップする', async () => {
      const url = 'https://example.com/private';
      const mockPrivacyInfo = {
        isPrivate: true,
        reason: 'set-cookie' as const,
        timestamp: Date.now()
      };

      RecordingLogic.cacheState.privacyCache = new Map([[url, mockPrivacyInfo]]);

      const mockObsidian = { appendToDailyNote: jest.fn().mockResolvedValue(undefined) } as any;
      const mockAiClient = {
        // @ts-expect-error - jest.fn() type narrowing issue
        generateSummary: jest.fn().mockResolvedValue('summary')
      } as any;
      const logic = new RecordingLogic(mockObsidian, mockAiClient);

      const result = await logic.record({
        title: 'Test',
        url,
        content: 'content',
        force: true
      });

      expect(result.success).toBe(true);
      expect(mockObsidian.appendToDailyNote).toHaveBeenCalled();
    });

    test('キャッシュミス時は通常通り保存を続行する', async () => {
      const url = 'https://example.com/unknown';

      RecordingLogic.cacheState.privacyCache = new Map();

      const mockObsidian = { appendToDailyNote: jest.fn().mockResolvedValue(undefined) } as any;
      const mockAiClient = {
        // @ts-expect-error - jest.fn() type narrowing issue
        generateSummary: jest.fn().mockResolvedValue('summary')
      } as any;
      const logic = new RecordingLogic(mockObsidian, mockAiClient);

      const result = await logic.record({
        title: 'Test',
        url,
        content: 'content'
      });

      expect(result.success).toBe(true);
      expect(mockObsidian.appendToDailyNote).toHaveBeenCalled();
    });
  });

  describe('Privacy Integration (Full Flow)', () => {
    beforeEach(() => {
      RecordingLogic.invalidatePrivacyCache();
      RecordingLogic.invalidateSettingsCache();
      RecordingLogic.invalidateUrlCache();

      // 既存のmock setup
      jest.clearAllMocks();
      if (!chrome.notifications) {
        chrome.notifications = { create: jest.fn() };
      }

      // @ts-expect-error - jest.fn() type narrowing issue
      storage.getSettings.mockResolvedValue({ PRIVACY_MODE: 'full_pipeline', PII_SANITIZE_LOGS: true });
      // @ts-expect-error - jest.fn() type narrowing issue
      storage.getSavedUrlsWithTimestamps.mockResolvedValue(new Map());
      // @ts-expect-error - jest.fn() type narrowing issue
      storage.setSavedUrlsWithTimestamps.mockResolvedValue();
      // @ts-expect-error - jest.fn() type narrowing issue
      domainUtils.isDomainAllowed.mockResolvedValue(true);
      // @ts-expect-error - jest.fn() type narrowing issue
      privacy.PrivacyPipeline.mockImplementation(() => ({
        // @ts-expect-error - jest.fn() type narrowing issue
        process: jest.fn().mockResolvedValue({ summary: 'Test summary', maskedCount: 0 })
      }));
    });

    test('プライベートページ → 警告 → キャンセル → 保存されない', async () => {
      const url = 'https://bank.example.com/account';

      // ヘッダー検出をシミュレート
      RecordingLogic.cacheState.privacyCache = new Map([
        [url, {
          isPrivate: true,
          reason: 'cache-control' as const,
          timestamp: Date.now()
        }]
      ]);

      const mockObsidian = { appendToDailyNote: jest.fn() } as any;
      const mockAiClient = {} as any;
      const logic = new RecordingLogic(mockObsidian, mockAiClient);

      const result = await logic.record({
        title: 'Bank Account',
        url,
        content: 'private data'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('PRIVATE_PAGE_DETECTED');
      expect(result.reason).toBe('cache-control');
      expect(mockObsidian.appendToDailyNote).not.toHaveBeenCalled();
    });

    test('プライベートページ → 警告 → 強制保存 → 保存される', async () => {
      const url = 'https://bank.example.com/account';

      RecordingLogic.cacheState.privacyCache = new Map([
        [url, {
          isPrivate: true,
          reason: 'set-cookie' as const,
          timestamp: Date.now()
        }]
      ]);

      const mockObsidian = { appendToDailyNote: jest.fn().mockResolvedValue(undefined) } as any;
      const mockAiClient = {
        // @ts-expect-error - jest.fn() type narrowing issue
        generateSummary: jest.fn().mockResolvedValue('summary')
      } as any;
      const logic = new RecordingLogic(mockObsidian, mockAiClient);

      // force=true で再試行
      const result = await logic.record({
        title: 'Bank Account',
        url,
        content: 'private data',
        force: true
      });

      expect(result.success).toBe(true);
      expect(mockObsidian.appendToDailyNote).toHaveBeenCalled();
    });

    test('通常ページ → 警告なし → 保存される', async () => {
      const url = 'https://public.example.com/article';

      RecordingLogic.cacheState.privacyCache = new Map([
        [url, {
          isPrivate: false,
          timestamp: Date.now()
        }]
      ]);

      const mockObsidian = { appendToDailyNote: jest.fn().mockResolvedValue(undefined) } as any;
      const mockAiClient = {
        // @ts-expect-error - jest.fn() type narrowing issue
        generateSummary: jest.fn().mockResolvedValue('summary')
      } as any;
      const logic = new RecordingLogic(mockObsidian, mockAiClient);

      const result = await logic.record({
        title: 'Public Article',
        url,
        content: 'public content'
      });

      expect(result.success).toBe(true);
      expect(mockObsidian.appendToDailyNote).toHaveBeenCalled();
    });

    test('キャッシュなし(ヘッダー未取得) → 保存継続', async () => {
      const url = 'https://unknown.example.com/page';

      RecordingLogic.cacheState.privacyCache = new Map();

      const mockObsidian = { appendToDailyNote: jest.fn().mockResolvedValue(undefined) } as any;
      const mockAiClient = {
        // @ts-expect-error - jest.fn() type narrowing issue
        generateSummary: jest.fn().mockResolvedValue('summary')
      } as any;
      const logic = new RecordingLogic(mockObsidian, mockAiClient);

      const result = await logic.record({
        title: 'Unknown Page',
        url,
        content: 'content'
      });

      expect(result.success).toBe(true);
      expect(mockObsidian.appendToDailyNote).toHaveBeenCalled();
    });
  });

  describe('requireConfirmation', () => {
    beforeEach(() => {
      RecordingLogic.invalidatePrivacyCache();
      RecordingLogic.invalidateSettingsCache();
      RecordingLogic.invalidateUrlCache();

      // Chrome notifications APIが存在する場合のみモック
      if (!chrome.notifications) {
        chrome.notifications = { create: jest.fn() };
      }

      // Reset cache state
      RecordingLogic.cacheState = {
        settingsCache: null,
        cacheTimestamp: null,
        cacheVersion: 0,
        urlCache: null,
        urlCacheTimestamp: null,
        privacyCache: null,
        privacyCacheTimestamp: null
      };

      jest.clearAllMocks();

      // @ts-expect-error - jest.fn() type narrowing issue
      storage.getSettings.mockResolvedValue({ PRIVACY_MODE: 'full_pipeline', PII_SANITIZE_LOGS: true });
      // @ts-expect-error - jest.fn() type narrowing issue
      storage.getSavedUrlsWithTimestamps.mockResolvedValue(new Map());
      // @ts-expect-error - jest.fn() type narrowing issue
      storage.setSavedUrlsWithTimestamps.mockResolvedValue();
      // @ts-expect-error - jest.fn() type narrowing issue
      domainUtils.isDomainAllowed.mockResolvedValue(true);
      // @ts-expect-error - jest.fn() type narrowing issue
      privacy.PrivacyPipeline.mockImplementation(() => ({
        // @ts-expect-error - jest.fn() type narrowing issue
        process: jest.fn().mockResolvedValue({ summary: 'Test summary', maskedCount: 0 })
      }));
      // @ts-expect-error - jest.fn() type narrowing issue
      pendingStorage.addPendingPage.mockResolvedValue(undefined);
    });

    test('プライベートページかつrequireConfirmation=trueの場合、pendingに保存してconfirmationRequiredを返す', async () => {
      const url = 'https://bank.example.com/account';
      const mockPrivacyInfo = {
        isPrivate: true,
        reason: 'cache-control' as const,
        timestamp: Date.now()
      };

      // キャッシュに追加
      RecordingLogic.cacheState.privacyCache = new Map([[url, mockPrivacyInfo]]);

      const mockObsidian = { appendToDailyNote: jest.fn() } as any;
      const mockAiClient = {} as any;
      const logic = new RecordingLogic(mockObsidian, mockAiClient);

      // @ts-expect-error - requireConfirmation is part of RecordingData extension
      const result = await logic.record({
        title: 'Bank Account',
        url,
        content: 'private data',
        headerValue: 'no-cache',
        requireConfirmation: true
      });

      // pendingに保存されていることを確認
      expect(pendingStorage.addPendingPage).toHaveBeenCalledWith({
        url,
        title: 'Bank Account',
        timestamp: expect.any(Number),
        reason: 'cache-control',
        headerValue: 'no-cache',
        expiry: expect.any(Number)
      });

      // confirmationRequiredがtrueで返されることを確認
      expect(result.success).toBe(false);
      expect(result.confirmationRequired).toBe(true);
      expect(result.error).toBe('PRIVATE_PAGE_DETECTED');
      expect(result.reason).toBe('cache-control');

      // Obsidianには保存されないことを確認
      expect(mockObsidian.appendToDailyNote).not.toHaveBeenCalled();
    });

    test('requireConfirmation=falseのプライベートページはpendingに保存してエラーを返す', async () => {
      const url = 'https://bank.example.com/account';
      const mockPrivacyInfo = {
        isPrivate: true,
        reason: 'cache-control' as const,
        timestamp: Date.now(),
        headers: {
          cacheControl: 'private',
          hasCookie: false,
          hasAuth: false
        }
      };

      // キャッシュに追加
      RecordingLogic.cacheState.privacyCache = new Map([[url, mockPrivacyInfo]]);

      const mockObsidian = { appendToDailyNote: jest.fn() } as any;
      const mockAiClient = {} as any;
      const logic = new RecordingLogic(mockObsidian, mockAiClient);

      // @ts-expect-error - requireConfirmation is part of RecordingData extension
      const result = await logic.record({
        title: 'Bank Account',
        url,
        content: 'private data',
        headerValue: 'no-cache',
        requireConfirmation: false
      });

      // pendingに保存されることを確認（自動記録動作）
      expect(pendingStorage.addPendingPage).toHaveBeenCalledWith({
        url,
        title: 'Bank Account',
        timestamp: expect.any(Number),
        reason: 'cache-control',
        headerValue: 'no-cache',
        expiry: expect.any(Number)
      });

      // PRIVATE_PAGE_DETECTEDエラーが返されることを確認
      expect(result.success).toBe(false);
      expect(result.confirmationRequired).toBeUndefined();
      expect(result.error).toBe('PRIVATE_PAGE_DETECTED');
    });

    test('公開ページの場合、requireConfirmation=trueでも通常通り保存される', async () => {
      const url = 'https://public.example.com/article';
      const mockPrivacyInfo = {
        isPrivate: false,
        timestamp: Date.now()
      };

      // キャッシュに追加
      RecordingLogic.cacheState.privacyCache = new Map([[url, mockPrivacyInfo]]);

      const mockObsidian = { appendToDailyNote: jest.fn().mockResolvedValue(undefined) } as any;
      const mockAiClient = {
        // @ts-expect-error - jest.fn() type narrowing issue
        generateSummary: jest.fn().mockResolvedValue('summary')
      } as any;
      const logic = new RecordingLogic(mockObsidian, mockAiClient);

      // @ts-expect-error - requireConfirmation is part of RecordingData extension
      const result = await logic.record({
        title: 'Public Article',
        url,
        content: 'public content',
        headerValue: 'public',
        requireConfirmation: true
      });

      // pendingには保存されないことを確認
      expect(pendingStorage.addPendingPage).not.toHaveBeenCalled();

      // 通常通り保存されることを確認
      expect(result.success).toBe(true);
      expect(mockObsidian.appendToDailyNote).toHaveBeenCalled();
    });
  });

  describe('record - pending page on auto recording', () => {
    beforeEach(() => {
      RecordingLogic.invalidatePrivacyCache();
      RecordingLogic.invalidateSettingsCache();
      RecordingLogic.invalidateUrlCache();

      if (!chrome.notifications) {
        chrome.notifications = { create: jest.fn() };
      }

      RecordingLogic.cacheState = {
        settingsCache: null,
        cacheTimestamp: null,
        cacheVersion: 0,
        urlCache: null,
        urlCacheTimestamp: null,
        privacyCache: null,
        privacyCacheTimestamp: null
      };

      jest.clearAllMocks();

      // @ts-expect-error - jest.fn() type narrowing issue
      storage.getSettings.mockResolvedValue({ PRIVACY_MODE: 'full_pipeline', PII_SANITIZE_LOGS: true });
      // @ts-expect-error - jest.fn() type narrowing issue
      storage.getSavedUrlsWithTimestamps.mockResolvedValue(new Map());
      // @ts-expect-error - jest.fn() type narrowing issue
      storage.setSavedUrlsWithTimestamps.mockResolvedValue();
      // @ts-expect-error - jest.fn() type narrowing issue
      domainUtils.isDomainAllowed.mockResolvedValue(true);
      // @ts-expect-error - jest.fn() type narrowing issue
      privacy.PrivacyPipeline.mockImplementation(() => ({
        // @ts-expect-error - jest.fn() type narrowing issue
        process: jest.fn().mockResolvedValue({ summary: 'Test summary', maskedCount: 0 })
      }));
      // @ts-expect-error - jest.fn() type narrowing issue
      pendingStorage.addPendingPage.mockResolvedValue(undefined);
    });

    it('should save to pending pages and return error for private page without requireConfirmation', async () => {
      const url = 'https://finance.yahoo.co.jp/quote/AMZN';
      const privateInfo: PrivacyInfo = {
        isPrivate: true,
        reason: 'cache-control',
        timestamp: Date.now(),
        headers: {
          cacheControl: 'Cache-Control: private',
          hasCookie: false,
          hasAuth: false
        }
      };

      // Setup privacy cache to return private page
      RecordingLogic.cacheState.privacyCache = new Map([[url, privateInfo]]);

      const mockObsidian = { appendToDailyNote: jest.fn() } as any;
      const mockAiClient = {} as any;
      const recordingLogic = new RecordingLogic(mockObsidian, mockAiClient);

      const response = await recordingLogic.record({
        title: 'Private Page',
        url,
        content: '<html></html>'
        // requireConfirmation is false by default, so NOT passed
      });

      expect(response.success).toBe(false);
      expect(response.error).toBe('PRIVATE_PAGE_DETECTED');
      expect(response.confirmationRequired).toBeUndefined();

      // Auto-ordered private pages are saved to pending for later processing
      expect(pendingStorage.addPendingPage).toHaveBeenCalledWith({
        url,
        title: 'Private Page',
        timestamp: expect.any(Number),
        reason: 'cache-control',
        headerValue: 'Cache-Control: private',
        expiry: expect.any(Number)
      });
      expect(mockObsidian.appendToDailyNote).not.toHaveBeenCalled();
    });
  });

  describe('headerValue handling', () => {
    beforeEach(() => {
      RecordingLogic.invalidatePrivacyCache();
      RecordingLogic.invalidateSettingsCache();
      RecordingLogic.invalidateUrlCache();

      if (!chrome.notifications) {
        chrome.notifications = { create: jest.fn() };
      }

      RecordingLogic.cacheState = {
        settingsCache: null,
        cacheTimestamp: null,
        cacheVersion: 0,
        urlCache: null,
        urlCacheTimestamp: null,
        privacyCache: null,
        privacyCacheTimestamp: null
      };

      jest.clearAllMocks();

      // @ts-expect-error - jest.fn() type narrowing issue
      storage.getSettings.mockResolvedValue({ PRIVACY_MODE: 'full_pipeline', PII_SANITIZE_LOGS: true });
      // @ts-expect-error - jest.fn() type narrowing issue
      storage.getSavedUrlsWithTimestamps.mockResolvedValue(new Map());
      // @ts-expect-error - jest.fn() type narrowing issue
      storage.setSavedUrlsWithTimestamps.mockResolvedValue();
      // @ts-expect-error - jest.fn() type narrowing issue
      domainUtils.isDomainAllowed.mockResolvedValue(true);
      // @ts-expect-error - jest.fn() type narrowing issue
      privacy.PrivacyPipeline.mockImplementation(() => ({
        // @ts-expect-error - jest.fn() type narrowing issue
        process: jest.fn().mockResolvedValue({ summary: 'Test summary', maskedCount: 0 })
      }));
      // @ts-expect-error - jest.fn() type narrowing issue
      pendingStorage.addPendingPage.mockResolvedValue(undefined);
    });

    test('headerValueはpendingページに正しく保存される', async () => {
      const url = 'https://example.com/private';
      const mockPrivacyInfo = {
        isPrivate: true,
        reason: 'cache-control' as const,
        timestamp: Date.now()
      };

      RecordingLogic.cacheState.privacyCache = new Map([[url, mockPrivacyInfo]]);

      const mockObsidian = { appendToDailyNote: jest.fn() } as any;
      const mockAiClient = {} as any;
      const logic = new RecordingLogic(mockObsidian, mockAiClient);

      const testHeaderValue = 'no-cache, no-store, must-revalidate';
      // @ts-expect-error - requireConfirmation is part of RecordingData extension
      const result = await logic.record({
        title: 'Private Page',
        url,
        content: 'content',
        headerValue: testHeaderValue,
        requireConfirmation: true
      });

      expect(pendingStorage.addPendingPage).toHaveBeenCalledWith({
        url,
        title: 'Private Page',
        timestamp: expect.any(Number),
        reason: 'cache-control',
        headerValue: testHeaderValue,
        expiry: expect.any(Number)
      });
      expect(result.confirmationRequired).toBe(true);
    });

    test('headerValueが未指定の場合は空文字列で保存される', async () => {
      const url = 'https://example.com/private';
      const mockPrivacyInfo = {
        isPrivate: true,
        reason: 'set-cookie' as const,
        timestamp: Date.now()
      };

      RecordingLogic.cacheState.privacyCache = new Map([[url, mockPrivacyInfo]]);

      const mockObsidian = { appendToDailyNote: jest.fn() } as any;
      const mockAiClient = {} as any;
      const logic = new RecordingLogic(mockObsidian, mockAiClient);

      // headerValueを指定せず、requireConfirmationを指定
      // @ts-expect-error - requireConfirmation is part of RecordingData extension
      const result = await logic.record({
        title: 'Private Page',
        url,
        content: 'content',
        requireConfirmation: true
      });

      // 空文字列で保存されることを確認
      expect(pendingStorage.addPendingPage).toHaveBeenCalledWith({
        url,
        title: 'Private Page',
        timestamp: expect.any(Number),
        reason: 'set-cookie',
        headerValue: '',
        expiry: expect.any(Number)
      });
      expect(result.confirmationRequired).toBe(true);
    });

    test('headerValueが1024文字を超える場合は切り詰められて保存される', async () => {
      const url = 'https://example.com/private';
      const mockPrivacyInfo = {
        isPrivate: true,
        reason: 'authorization' as const,
        timestamp: Date.now()
      };

      RecordingLogic.cacheState.privacyCache = new Map([[url, mockPrivacyInfo]]);

      const mockObsidian = { appendToDailyNote: jest.fn() } as any;
      const mockAiClient = {} as any;
      const logic = new RecordingLogic(mockObsidian, mockAiClient);

      // 1024文字を超える長いheaderValueを作成
      const longHeaderValue = 'x'.repeat(2000);
      const expectedHeaderValue = 'x'.repeat(1024);

      // @ts-expect-error - requireConfirmation is part of RecordingData extension
      const result = await logic.record({
        title: 'Private Page',
        url,
        content: 'content',
        headerValue: longHeaderValue,
        requireConfirmation: true
      });

      // 1024文字に切り詰められていることを確認
      expect(pendingStorage.addPendingPage).toHaveBeenCalledWith({
        url,
        title: 'Private Page',
        timestamp: expect.any(Number),
        reason: 'authorization',
        headerValue: expectedHeaderValue,
        expiry: expect.any(Number)
      });
      expect(result.confirmationRequired).toBe(true);
    });
  });
});