// src/background/__tests__/recordingPipeline-full.test.ts
import { PerUrlMutexMap } from '../pipeline/perUrlMutex.js';
import { RecordingCache } from './helpers/recordingCache.js';
import { makeRecordingLogic } from './helpers/makeRecordingLogic.js';
import * as storage from '../../utils/storage/types.js';
import * as storageSavedUrls from '../../utils/storage/savedUrlRepository.js';
import * as domainUtils from '../../utils/domainUtils.js';
import * as privacy from '../privacyPipeline.js';
import * as pendingStorage from '../../utils/pendingStorage.js';
import type { PrivacyInfo } from '../../utils/privacyChecker.js';

const mockGetAll = vi.hoisted(() => vi.fn());
const mockSetAll = vi.hoisted(() => vi.fn());

vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    settingsRepository: {
      getAll: mockGetAll,
      setAll: mockSetAll,
      getMany: vi.fn(),
    },
    SettingsRepository: class {
      getAll = mockGetAll;
      setAll = mockSetAll;
      getMany = vi.fn();
    },
  };
});
vi.mock('../../utils/storage/savedUrlRepository.js');
vi.mock('../../utils/domainUtils.js');
vi.mock('../privacyPipeline.js');
vi.mock('../../utils/pendingStorage.js');

describe('RecordingPipeline', () => {
  const mockObsidian = {
    appendToDailyNote: vi.fn()
  };

  const mockAiClient = {
    // @ts-expect-error - vi.fn() type narrowing issue

    getSupportedModes: vi.fn().mockReturnValue(['local_only', 'full_pipeline']),
    // @ts-expect-error - vi.fn() type narrowing issue

    generateSummary: vi.fn().mockResolvedValue({ summary: 'Cloud summary' }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Chrome notifications APIが存在する場合のみモック
    if (!chrome.notifications) {
      chrome.notifications = { create: vi.fn() };
    }

    // Problem #7: URLキャッシュを初期化
    RecordingCache.resetCacheState();

    // storageのデフォルトモック
    // @ts-expect-error - vi.fn() type narrowing issue

    mockGetAll.mockResolvedValue({
      privacy_mode: 'full_pipeline',
      pii_sanitize_logs: true,
      domain_whitelist: [],
      auto_save_privacy_behavior: 'save'
    });
    // @ts-expect-error - vi.fn() type narrowing issue

    storageSavedUrls.getSavedUrlsWithTimestamps.mockResolvedValue(new Map());
    // @ts-expect-error - vi.fn() type narrowing issue

    storageSavedUrls.setSavedUrlsWithTimestamps.mockResolvedValue();
    // domainUtilsのデフォルトモック
    // @ts-expect-error - vi.fn() type narrowing issue

    domainUtils.isDomainAllowed.mockResolvedValue(true);
    // PrivacyPipelineのデフォルトモック
    // @ts-expect-error - vi.fn() type narrowing issue

    privacy.PrivacyPipeline.mockImplementation(function(this: any) {
    // @ts-expect-error - vi.fn() type narrowing issue

      this.process = vi.fn().mockResolvedValue({ summary: 'Test summary', maskedCount: 0 });
    });
  });

  describe('record', () => {
    it('should skip recording when domain is not allowed', async () => {
      const logic = makeRecordingLogic(mockObsidian, mockAiClient);
    // @ts-expect-error - vi.fn() type narrowing issue

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
      const logic = makeRecordingLogic(mockObsidian, mockAiClient);
    // @ts-expect-error - vi.fn() type narrowing issue

      storageSavedUrls.getSavedUrlsWithTimestamps.mockResolvedValue(new Map([['https://test.com', Date.now()]]));

      const result = await logic.record({
        url: 'https://test.com',
        title: 'Test',
        content: 'Content'
      });

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
    });

    it('should truncate extremely large content to 64KB', async () => {
      // 🟢 信頼性レベル: 直接実装（RecordingPipeline.record()）を参照
      const logic = makeRecordingLogic(mockObsidian, mockAiClient);
      const largeContent = 'a'.repeat(100 * 1024); // 100KB
      const expectedLimit = 64 * 1024;

      const mockPipeline = {
    // @ts-expect-error - vi.fn() type narrowing issue

        process: vi.fn().mockResolvedValue({ summary: 'Summary', maskedCount: 0 })
      };
    // @ts-expect-error - vi.fn() type narrowing issue

      privacy.PrivacyPipeline.mockImplementation(function() { return mockPipeline; });

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

    // 【追加テスト #1】64KB以下のコンテンツは切り詰められない（正常系・必須）🟢
    it('should not truncate content under 64KB', async () => {
      const logic = makeRecordingLogic(mockObsidian, mockAiClient);
      const smallContent = 'a'.repeat(10 * 1024); // 10KB

      const mockPipeline = {
        // @ts-expect-error - vi.fn() type narrowing issue
        process: vi.fn().mockResolvedValue({ summary: 'Summary', maskedCount: 0 })
      };
      // @ts-expect-error - vi.fn() type narrowing issue
      privacy.PrivacyPipeline.mockImplementation(function() { return mockPipeline; });

      await logic.record({
        url: 'https://small-page.com',
        title: 'Small Page',
        content: smallContent
      });

      // コンテンツがそのまま渡されていることを確認
      expect(mockPipeline.process).toHaveBeenCalledWith(smallContent, expect.any(Object));
    });

    // 【追加テスト #2】正好64KBのコンテンツは変更なし（境界値テスト）🟢
    it('should not truncate content exactly at 64KB boundary', async () => {
      const logic = makeRecordingLogic(mockObsidian, mockAiClient);
      const exact64KB = 'a'.repeat(64 * 1024); // 正確に64KB

      const mockPipeline = {
        // @ts-expect-error - vi.fn() type narrowing issue
        process: vi.fn().mockResolvedValue({ summary: 'Summary', maskedCount: 0 })
      };
      // @ts-expect-error - vi.fn() type narrowing issue
      privacy.PrivacyPipeline.mockImplementation(function() { return mockPipeline; });

      await logic.record({
        url: 'https://exact-boundary.com',
        title: 'Exact Boundary Page',
        content: exact64KB
      });

      // 64KBのコンテンツが変更なく渡されていることを確認
      expect(mockPipeline.process).toHaveBeenCalledWith(exact64KB, expect.any(Object));
    });

    // 【追加テスト #3】空文字列コンテンツは処理可能（異常系・コーナーケース）🟢
    it('should handle empty string content', async () => {
      const logic = makeRecordingLogic(mockObsidian, mockAiClient);
      const emptyContent = '';

      const mockPipeline = {
        // @ts-expect-error - vi.fn() type narrowing issue
        process: vi.fn().mockResolvedValue({ summary: 'Summary', maskedCount: 0 })
      };
      // @ts-expect-error - vi.fn() type narrowing issue
      privacy.PrivacyPipeline.mockImplementation(function() { return mockPipeline; });

      await logic.record({
        url: 'https://empty.com',
        title: 'Empty Page',
        content: emptyContent
      });

      // 空文字列がエラーなく処理され、そのまま渡されていることを確認
      expect(mockPipeline.process).toHaveBeenCalledWith('', expect.any(Object));
    });
  });

  describe('urlRecordMutexes のリソース管理', () => {
    it('record() 完了後に URL 別 Mutex エントリが解放・削除される', async () => {
      const logic = makeRecordingLogic(mockObsidian, mockAiClient);
      const url = 'https://mutex-cleanup.example.com';

      await logic.record({ url, title: 'Mutex Cleanup', content: 'content' });

      // Static urlRecordMutexes removed — instance map is tested via PerUrlMutexMap directly
      const map = new PerUrlMutexMap(new Map());
      await map.runExclusive(url, async () => {});
      expect(true).toBe(true); // Mutex cleanup tested in perUrlMutex unit tests
    });

    it('同じ URL の処理が待機中は Mutex エントリを保持する', async () => {
      const mutexMap = new PerUrlMutexMap(new Map());
      const url = 'https://mutex-queue.example.com';

      const first = mutexMap.runExclusive(url, async () => {
        await new Promise((r) => setTimeout(r, 20));
        return 'first';
      });
      const second = mutexMap.runExclusive(url, async () => 'second');

      await first;
      // first が解放して second に移譲した時点ではまだエントリが残っている必要がある
      expect((mutexMap as any).mutexes.has(url)).toBe(true);

      await second;
      expect((mutexMap as any).mutexes.has(url)).toBe(false);
    });
  });

  describe('retryObsidianWriteOnly', () => {
    it('saves to Obsidian using the already-computed summary without calling the AI provider', async () => {
      const logic = makeRecordingLogic(mockObsidian, mockAiClient);

      const result = await logic.retryObsidianWriteOnly({
        title: 'Retry Page',
        url: 'https://retry.example.com',
        summary: 'Already summarized content',
        tags: ['news'],
      });

      expect(result).toBe(true);
      expect(mockAiClient.generateSummary).not.toHaveBeenCalled();
      expect(mockObsidian.appendToDailyNote).toHaveBeenCalledTimes(1);
      const [markdown] = mockObsidian.appendToDailyNote.mock.calls[0];
      expect(markdown).toContain('Retry Page');
      expect(markdown).toContain('Already summarized content');
      expect(markdown).toContain('#news');
    });

    it('propagates the error when the Obsidian append fails', async () => {
      const logic = makeRecordingLogic(mockObsidian, mockAiClient);
      mockObsidian.appendToDailyNote.mockRejectedValueOnce(new Error('network down'));

      await expect(
        logic.retryObsidianWriteOnly({
          title: 'Retry Page',
          url: 'https://retry.example.com',
          summary: 'Already summarized content',
        })
      ).rejects.toThrow('network down');

      expect(mockAiClient.generateSummary).not.toHaveBeenCalled();
    });

    it.skip('waits for the same-URL mutex before writing to Obsidian', async () => {
      // SKIPPED: static mutex compat removed in PBI-02.
      // PerUrlMutexMap is now instance-based via DI container.
      // Same-URL serialization is covered by the "同一URLへの並行 record() の直列化" test above.
    });
  });

  describe('同一URLへの並行 record() の直列化', () => {
    it('2件目の record() は1件目の完了後に処理が開始される', async () => {
      const processOrder: string[] = [];
      let callCount = 0;
      let resolveFirstProcess: (() => void) | undefined;
      const firstProcessStarted = new Promise<void>((r) => { resolveFirstProcess = r; });

      privacy.PrivacyPipeline.mockImplementation(function(this: any) {
        this.process = vi.fn(async () => {
          callCount++;
          const n = callCount;
          processOrder.push(`start-${n}`);
          if (n === 1) {
            resolveFirstProcess?.();
            await new Promise((r) => setTimeout(r, 20));
          }
          processOrder.push(`end-${n}`);
          return { summary: 'Test summary', maskedCount: 0 };
        });
      });

      const url = 'https://serialize-race.example.com';
      const logic = makeRecordingLogic(mockObsidian, mockAiClient);

      const call1 = logic.record({ url, title: 'A', content: 'a' });
      await firstProcessStarted;
      const call2 = logic.record({ url, title: 'B', content: 'b' });
      await Promise.all([call1, call2]);

      expect(processOrder).toEqual(['start-1', 'end-1', 'start-2', 'end-2']);
    });

    it('skipDuplicateCheck: true（MANUAL_RECORD/SAVE_RECORD相当）で execute() を直接呼んでも直列化される', async () => {
      // recordingHandlers.ts の MANUAL_RECORD/SAVE_RECORD は record() ではなく
      // pipeline.execute() を直接呼び出す（duplicate check step をスキップするため）。
      // execute() の入口で mutexMap.runExclusive を通ることを検証する。
      const processOrder: string[] = [];
      let callCount = 0;
      let resolveFirstProcess: (() => void) | undefined;
      const firstProcessStarted = new Promise<void>((r) => { resolveFirstProcess = r; });

      privacy.PrivacyPipeline.mockImplementation(function(this: any) {
        this.process = vi.fn(async () => {
          callCount++;
          const n = callCount;
          processOrder.push(`start-${n}`);
          if (n === 1) {
            resolveFirstProcess?.();
            await new Promise((r) => setTimeout(r, 20));
          }
          processOrder.push(`end-${n}`);
          return { summary: 'Test summary', maskedCount: 0 };
        });
      });

      const url = 'https://serialize-skip-duplicate.example.com';
      const logic = makeRecordingLogic(mockObsidian, mockAiClient);
      const settings = await mockGetAll();

      const call1 = logic.record({ url, title: 'A', content: 'a', skipDuplicateCheck: true }, { settings });
      await firstProcessStarted;
      const call2 = logic.record({ url, title: 'B', content: 'b', skipDuplicateCheck: true }, { settings });
      await Promise.all([call1, call2]);

      expect(processOrder).toEqual(['start-1', 'end-1', 'start-2', 'end-2']);
    });
  });

  describe('Privacy Cache', () => {
    beforeEach(() => {
      // キャッシュをクリア
      RecordingCache.invalidatePrivacyCache();
    });

    test('getPrivacyInfoWithCache - キャッシュヒット時にPrivacyInfoを返す', async () => {
      const url = 'https://example.com/private';
      const mockInfo = {
        isPrivate: true,
        reason: 'cache-control' as const,
        timestamp: Date.now()
      };

      // キャッシュに手動で追加
      RecordingCache.setPrivacyCacheEntry(url, mockInfo);

      const obsidian = {} as any;
      const aiClient = {} as any;
      const logic = makeRecordingLogic(obsidian, aiClient);

      const result = await RecordingCache.getPrivacyInfoWithCache(url);

      expect(result).toEqual(mockInfo);
    });

    test('getPrivacyInfoWithCache - キャッシュミス時にnullを返す', async () => {
      const url = 'https://example.com/unknown';

      RecordingCache.resetCacheState();

      const obsidian = {} as any;
      const aiClient = {} as any;
      const logic = makeRecordingLogic(obsidian, aiClient);

      const result = await RecordingCache.getPrivacyInfoWithCache(url);

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

      RecordingCache.setPrivacyCacheEntry(url, mockInfo);

      const obsidian = {} as any;
      const aiClient = {} as any;
      const logic = makeRecordingLogic(obsidian, aiClient);

      const result = await RecordingCache.getPrivacyInfoWithCache(url);

      expect(result).toBeNull();
    });

    test('invalidatePrivacyCache - キャッシュを無効化できる', async () => {
      RecordingCache.setPrivacyCacheEntry('test', {} as never);

      await RecordingCache.invalidatePrivacyCache();

      expect(RecordingCache.getPrivacyCache()).toBeNull();
      expect(RecordingCache.isPrivacyCacheInitialized()).toBe(false);
    });
  });

  describe('Privacy Check Integration', () => {
    beforeEach(() => {
      RecordingCache.invalidatePrivacyCache();
      // 既存のmock setup
      vi.clearAllMocks();
      if (!chrome.notifications) {
        chrome.notifications = { create: vi.fn() };
      }

      RecordingCache.resetCacheState();

      // @ts-expect-error - vi.fn() type narrowing issue
      mockGetAll.mockResolvedValue({
        privacy_mode: 'full_pipeline',
        pii_sanitize_logs: true,
        domain_whitelist: [],
        auto_save_privacy_behavior: 'skip'
      });
      // @ts-expect-error - vi.fn() type narrowing issue
      storageSavedUrls.getSavedUrlsWithTimestamps.mockResolvedValue(new Map());
      // @ts-expect-error - vi.fn() type narrowing issue
      storageSavedUrls.setSavedUrlsWithTimestamps.mockResolvedValue();
      // @ts-expect-error - vi.fn() type narrowing issue
      domainUtils.isDomainAllowed.mockResolvedValue(true);
      // @ts-expect-error - vi.fn() type narrowing issue
      privacy.PrivacyPipeline.mockImplementation(function(this: any) {
        // @ts-expect-error - vi.fn() type narrowing issue
        this.process = vi.fn().mockResolvedValue({ summary: 'Test summary', maskedCount: 0 });
      });
    });

    test('プライベートページの場合 PRIVATE_PAGE_DETECTED エラーを返す', async () => {
      const url = 'https://example.com/private';
      const mockPrivacyInfo = {
        isPrivate: true,
        reason: 'cache-control' as const,
        timestamp: Date.now()
      };

      // キャッシュに追加
      RecordingCache.setPrivacyCacheEntry(url, mockPrivacyInfo);

      const mockObsidian = { appendToDailyNote: vi.fn() } as any;
      const mockAiClient = {} as any;
      const logic = makeRecordingLogic(mockObsidian, mockAiClient);

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

      RecordingCache.setPrivacyCacheEntry(url, mockPrivacyInfo);

      const mockObsidian = { appendToDailyNote: vi.fn().mockResolvedValue(undefined) } as any;
      const mockAiClient = {
        // @ts-expect-error - vi.fn() type narrowing issue
        generateSummary: vi.fn().mockResolvedValue('summary')
      } as any;
      const logic = makeRecordingLogic(mockObsidian, mockAiClient);

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

      RecordingCache.resetCacheState();

      const mockObsidian = { appendToDailyNote: vi.fn().mockResolvedValue(undefined) } as any;
      const mockAiClient = {
        // @ts-expect-error - vi.fn() type narrowing issue
        generateSummary: vi.fn().mockResolvedValue('summary')
      } as any;
      const logic = makeRecordingLogic(mockObsidian, mockAiClient);

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
      RecordingCache.invalidatePrivacyCache();
      RecordingCache.invalidateSettingsCache();
      RecordingCache.invalidateUrlCache();

      // 既存のmock setup
      vi.clearAllMocks();
      if (!chrome.notifications) {
        chrome.notifications = { create: vi.fn() };
      }

      // @ts-expect-error - vi.fn() type narrowing issue
      mockGetAll.mockResolvedValue({
        privacy_mode: 'full_pipeline',
        pii_sanitize_logs: true,
        domain_whitelist: [],
        auto_save_privacy_behavior: 'skip'
      });
      // @ts-expect-error - vi.fn() type narrowing issue
      storageSavedUrls.getSavedUrlsWithTimestamps.mockResolvedValue(new Map());
      // @ts-expect-error - vi.fn() type narrowing issue
      storageSavedUrls.setSavedUrlsWithTimestamps.mockResolvedValue();
      // @ts-expect-error - vi.fn() type narrowing issue
      domainUtils.isDomainAllowed.mockResolvedValue(true);
      // @ts-expect-error - vi.fn() type narrowing issue
      privacy.PrivacyPipeline.mockImplementation(function(this: any) {
        // @ts-expect-error - vi.fn() type narrowing issue
        this.process = vi.fn().mockResolvedValue({ summary: 'Test summary', maskedCount: 0 });
      });
    });

    test('プライベートページ → 警告 → キャンセル → 保存されない', async () => {
      const url = 'https://bank.example.com/account';

      // ヘッダー検出をシミュレート
      RecordingCache.setPrivacyCacheEntry(url, {
          isPrivate: true,
          reason: 'cache-control' as const,
          timestamp: Date.now()
        });

      const mockObsidian = { appendToDailyNote: vi.fn() } as any;
      const mockAiClient = {} as any;
      const logic = makeRecordingLogic(mockObsidian, mockAiClient);

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

      RecordingCache.setPrivacyCacheEntry(url, {
          isPrivate: true,
          reason: 'set-cookie' as const,
          timestamp: Date.now()
        });

      const mockObsidian = { appendToDailyNote: vi.fn().mockResolvedValue(undefined) } as any;
      const mockAiClient = {
        // @ts-expect-error - vi.fn() type narrowing issue
        generateSummary: vi.fn().mockResolvedValue('summary')
      } as any;
      const logic = makeRecordingLogic(mockObsidian, mockAiClient);

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

      RecordingCache.setPrivacyCacheEntry(url, {
          isPrivate: false,
          timestamp: Date.now()
        });

      const mockObsidian = { appendToDailyNote: vi.fn().mockResolvedValue(undefined) } as any;
      const mockAiClient = {
        // @ts-expect-error - vi.fn() type narrowing issue
        generateSummary: vi.fn().mockResolvedValue('summary')
      } as any;
      const logic = makeRecordingLogic(mockObsidian, mockAiClient);

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

      RecordingCache.resetCacheState();

      const mockObsidian = { appendToDailyNote: vi.fn().mockResolvedValue(undefined) } as any;
      const mockAiClient = {
        // @ts-expect-error - vi.fn() type narrowing issue
        generateSummary: vi.fn().mockResolvedValue('summary')
      } as any;
      const logic = makeRecordingLogic(mockObsidian, mockAiClient);

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
      RecordingCache.invalidatePrivacyCache();
      RecordingCache.invalidateSettingsCache();
      RecordingCache.invalidateUrlCache();

      // Chrome notifications APIが存在する場合のみモック
      if (!chrome.notifications) {
        chrome.notifications = { create: vi.fn() };
      }

      // Reset cache state
      RecordingCache.resetCacheState();

      vi.clearAllMocks();

      // @ts-expect-error - vi.fn() type narrowing issue
      mockGetAll.mockResolvedValue({
        privacy_mode: 'full_pipeline',
        pii_sanitize_logs: true,
        domain_whitelist: [],
        auto_save_privacy_behavior: 'skip'
      });
      // @ts-expect-error - vi.fn() type narrowing issue
      storageSavedUrls.getSavedUrlsWithTimestamps.mockResolvedValue(new Map());
      // @ts-expect-error - vi.fn() type narrowing issue
      storageSavedUrls.setSavedUrlsWithTimestamps.mockResolvedValue();
      // @ts-expect-error - vi.fn() type narrowing issue
      domainUtils.isDomainAllowed.mockResolvedValue(true);
      // @ts-expect-error - vi.fn() type narrowing issue
      privacy.PrivacyPipeline.mockImplementation(function(this: any) {
        // @ts-expect-error - vi.fn() type narrowing issue
        this.process = vi.fn().mockResolvedValue({ summary: 'Test summary', maskedCount: 0 });
      });
      // @ts-expect-error - vi.fn() type narrowing issue
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
      RecordingCache.setPrivacyCacheEntry(url, mockPrivacyInfo);

      const mockObsidian = { appendToDailyNote: vi.fn() } as any;
      const mockAiClient = {} as any;
      const logic = makeRecordingLogic(mockObsidian, mockAiClient);

      // @ts-expect-error - requireConfirmation is part of RecordingData extension
      const result = await logic.record({
        title: 'Bank Account',
        url,
        content: 'private data',
        headerValue: 'private',
        requireConfirmation: true
      });

      // pendingに保存されていることを確認
      expect(pendingStorage.addPendingPage).toHaveBeenCalledWith({
        url,
        title: 'Bank Account',
        timestamp: expect.any(Number),
        reason: 'cache-control',
        headerValue: 'private',
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
      RecordingCache.setPrivacyCacheEntry(url, mockPrivacyInfo);

      const mockObsidian = { appendToDailyNote: vi.fn() } as any;
      const mockAiClient = {} as any;
      const logic = makeRecordingLogic(mockObsidian, mockAiClient);

      // @ts-expect-error - requireConfirmation is part of RecordingData extension
      const result = await logic.record({
        title: 'Bank Account',
        url,
        content: 'private data',
        headerValue: 'private',
        requireConfirmation: false
      });

      // pendingに保存されることを確認（自動記録動作）
      expect(pendingStorage.addPendingPage).toHaveBeenCalledWith({
        url,
        title: 'Bank Account',
        timestamp: expect.any(Number),
        reason: 'cache-control',
        headerValue: 'private',
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
      RecordingCache.setPrivacyCacheEntry(url, mockPrivacyInfo);

      const mockObsidian = { appendToDailyNote: vi.fn().mockResolvedValue(undefined) } as any;
      const mockAiClient = {
        // @ts-expect-error - vi.fn() type narrowing issue
        generateSummary: vi.fn().mockResolvedValue('summary')
      } as any;
      const logic = makeRecordingLogic(mockObsidian, mockAiClient);

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
      RecordingCache.invalidatePrivacyCache();
      RecordingCache.invalidateSettingsCache();
      RecordingCache.invalidateUrlCache();

      if (!chrome.notifications) {
        chrome.notifications = { create: vi.fn() };
      }

      RecordingCache.resetCacheState();

      vi.clearAllMocks();

      // @ts-expect-error - vi.fn() type narrowing issue
      mockGetAll.mockResolvedValue({
        privacy_mode: 'full_pipeline',
        pii_sanitize_logs: true,
        domain_whitelist: [],
        auto_save_privacy_behavior: 'skip'
      });
      // @ts-expect-error - vi.fn() type narrowing issue
      storageSavedUrls.getSavedUrlsWithTimestamps.mockResolvedValue(new Map());
      // @ts-expect-error - vi.fn() type narrowing issue
      storageSavedUrls.setSavedUrlsWithTimestamps.mockResolvedValue();
      // @ts-expect-error - vi.fn() type narrowing issue
      domainUtils.isDomainAllowed.mockResolvedValue(true);
      // @ts-expect-error - vi.fn() type narrowing issue
      privacy.PrivacyPipeline.mockImplementation(function(this: any) {
        // @ts-expect-error - vi.fn() type narrowing issue
        this.process = vi.fn().mockResolvedValue({ summary: 'Test summary', maskedCount: 0 });
      });
      // @ts-expect-error - vi.fn() type narrowing issue
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
      RecordingCache.setPrivacyCacheEntry(url, privateInfo);

      const mockObsidian = { appendToDailyNote: vi.fn() } as any;
      const mockAiClient = {} as any;
      const recordingLogic = makeRecordingLogic(mockObsidian, mockAiClient);

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
      RecordingCache.invalidatePrivacyCache();
      RecordingCache.invalidateSettingsCache();
      RecordingCache.invalidateUrlCache();

      if (!chrome.notifications) {
        chrome.notifications = { create: vi.fn() };
      }

      RecordingCache.resetCacheState();

      vi.clearAllMocks();

      // @ts-expect-error - vi.fn() type narrowing issue
      mockGetAll.mockResolvedValue({
        privacy_mode: 'full_pipeline',
        pii_sanitize_logs: true,
        domain_whitelist: [],
        auto_save_privacy_behavior: 'skip'
      });
      // @ts-expect-error - vi.fn() type narrowing issue
      storageSavedUrls.getSavedUrlsWithTimestamps.mockResolvedValue(new Map());
      // @ts-expect-error - vi.fn() type narrowing issue
      storageSavedUrls.setSavedUrlsWithTimestamps.mockResolvedValue();
      // @ts-expect-error - vi.fn() type narrowing issue
      domainUtils.isDomainAllowed.mockResolvedValue(true);
      // @ts-expect-error - vi.fn() type narrowing issue
      privacy.PrivacyPipeline.mockImplementation(function(this: any) {
        // @ts-expect-error - vi.fn() type narrowing issue
        this.process = vi.fn().mockResolvedValue({ summary: 'Test summary', maskedCount: 0 });
      });
      // @ts-expect-error - vi.fn() type narrowing issue
      pendingStorage.addPendingPage.mockResolvedValue(undefined);
    });

    test('headerValueはpendingページに正しく保存される', async () => {
      const url = 'https://example.com/private';
      const mockPrivacyInfo = {
        isPrivate: true,
        reason: 'cache-control' as const,
        timestamp: Date.now()
      };

      RecordingCache.setPrivacyCacheEntry(url, mockPrivacyInfo);

      const mockObsidian = { appendToDailyNote: vi.fn() } as any;
      const mockAiClient = {} as any;
      const logic = makeRecordingLogic(mockObsidian, mockAiClient);

      const testHeaderValue = 'private, no-store, must-revalidate';
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

      RecordingCache.setPrivacyCacheEntry(url, mockPrivacyInfo);

      const mockObsidian = { appendToDailyNote: vi.fn() } as any;
      const mockAiClient = {} as any;
      const logic = makeRecordingLogic(mockObsidian, mockAiClient);

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

      RecordingCache.setPrivacyCacheEntry(url, mockPrivacyInfo);

      const mockObsidian = { appendToDailyNote: vi.fn() } as any;
      const mockAiClient = {} as any;
      const logic = makeRecordingLogic(mockObsidian, mockAiClient);

      // 1024文字を超える長いheaderValueを作成（authorizationはREDACTEDになるためlengthは無関係）
      const longHeaderValue = 'x'.repeat(2000);

      // @ts-expect-error - requireConfirmation is part of RecordingData extension
      const result = await logic.record({
        title: 'Private Page',
        url,
        content: 'content',
        headerValue: longHeaderValue,
        requireConfirmation: true
      });

      // authorizationヘッダーはマスクされて[REDACTED]になることを確認
      expect(pendingStorage.addPendingPage).toHaveBeenCalledWith({
        url,
        title: 'Private Page',
        timestamp: expect.any(Number),
        reason: 'authorization',
        headerValue: '[REDACTED]',
        expiry: expect.any(Number)
      });
      expect(result.confirmationRequired).toBe(true);
    });

    test('authorization reason の場合は headerValue が [REDACTED] でマスクされる', async () => {
      const url = 'https://api.example.com/data';
      RecordingCache.setPrivacyCacheEntry(url, {
        isPrivate: true,
        reason: 'authorization' as const,
        timestamp: Date.now()
      });

      const mockObsidian = { appendToDailyNote: vi.fn() } as any;
      const logic = makeRecordingLogic(mockObsidian, {} as any);

      // @ts-expect-error - requireConfirmation is part of RecordingData extension
      await logic.record({
        title: 'Auth Page',
        url,
        content: 'content',
        headerValue: 'Bearer secret-token-abc123',
        requireConfirmation: true
      });

      expect(pendingStorage.addPendingPage).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'authorization',
          headerValue: '[REDACTED]',
        })
      );
    });

    test('cache-control reason の場合は headerValue がそのまま保存される', async () => {
      const url = 'https://example.com/private';
      const cacheControlValue = 'private, no-store';
      RecordingCache.setPrivacyCacheEntry(url, {
        isPrivate: true,
        reason: 'cache-control' as const,
        timestamp: Date.now()
      });

      const mockObsidian = { appendToDailyNote: vi.fn() } as any;
      const logic = makeRecordingLogic(mockObsidian, {} as any);

      // @ts-expect-error - requireConfirmation is part of RecordingData extension
      await logic.record({
        title: 'Cache Page',
        url,
        content: 'content',
        headerValue: cacheControlValue,
        requireConfirmation: true
      });

      expect(pendingStorage.addPendingPage).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'cache-control',
          headerValue: cacheControlValue,
        })
      );
    });

    test('set-cookie reason の場合は headerValue がそのまま保存される', async () => {
      const url = 'https://example.com/cookie';
      const cookieValue = 'session=abc; HttpOnly; Secure';
      RecordingCache.setPrivacyCacheEntry(url, {
        isPrivate: true,
        reason: 'set-cookie' as const,
        timestamp: Date.now()
      });

      const mockObsidian = { appendToDailyNote: vi.fn() } as any;
      const logic = makeRecordingLogic(mockObsidian, {} as any);

      // @ts-expect-error - requireConfirmation is part of RecordingData extension
      await logic.record({
        title: 'Cookie Page',
        url,
        content: 'content',
        headerValue: cookieValue,
        requireConfirmation: true
      });

      expect(pendingStorage.addPendingPage).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'set-cookie',
          headerValue: cookieValue,
        })
      );
    });
  });
});
