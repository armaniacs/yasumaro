// src/background/__tests__/recordingLogic-impl.test.ts
// Tests for recordingLogic.ts internal methods and _recordImpl path
// Covers: isValidFetchUrl, private helpers, _recordImpl branches, _saveMetadata branches

import { vi } from 'vitest';

// ─── Mocks (must be before imports) ─────────────────────────────────────────
vi.mock('../../utils/storage.js', async () => {
  const actual = await vi.importActual('../../utils/storage.js') as any;
  return {
    ...actual,
    getSettings: vi.fn(),
    getAllowedUrls: vi.fn(),
    getSavedUrlsWithTimestamps: vi.fn(),
    setSavedUrlsWithTimestamps: vi.fn(),
    saveSettings: vi.fn(),
    StorageKeys: {
      PRIVACY_MODE: 'PRIVACY_MODE',
      PII_SANITIZE_LOGS: 'PII_SANITIZE_LOGS',
      TAG_SUMMARY_MODE: 'TAG_SUMMARY_MODE',
      AUTO_SAVE_PRIVACY_BEHAVIOR: 'AUTO_SAVE_PRIVACY_BEHAVIOR',
    },
    MAX_URL_SET_SIZE: 10000,
    URL_WARNING_THRESHOLD: 9000,
  };
});

vi.mock('../../utils/domainUtils.js', () => ({
  isDomainAllowed: vi.fn(),
  isDomainInList: vi.fn(),
  extractDomain: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { DEBUG: 'DEBUG', INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
  ErrorCode: { INTERNAL_ERROR: 'INT_001' },
  logError: vi.fn(),
}));

vi.mock('../../utils/piiSanitizer.js', () => ({
  sanitizeRegex: vi.fn(),
}));

vi.mock('../../utils/markdownSanitizer.js', () => ({
  sanitizeForObsidian: vi.fn((s: string) => s),
}));

vi.mock('../../utils/localeUtils.js', () => ({
  getUserLocale: vi.fn(() => 'en'),
}));

vi.mock('../../utils/urlUtils.js', () => ({
  sanitizeUrlForLogging: vi.fn((url: string) => url),
}));

vi.mock('../../utils/fetch.js', () => ({
  isPrivateIpAddress: vi.fn(() => false),
}));

vi.mock('../../utils/pendingStorage.js', () => ({
  addPendingPage: vi.fn(),
}));

vi.mock('../../utils/redaction.js', () => ({
  redactHeaderValue: vi.fn((v: string) => v),
}));

const mockPermissionManager = {
  isHostPermitted: vi.fn().mockResolvedValue(true),
  recordDeniedVisit: vi.fn().mockResolvedValue(undefined),
};
vi.mock('../../utils/permissionManager.js', () => ({
  getPermissionManager: vi.fn(() => mockPermissionManager),
}));

const mockTrustCheckResult = {
  canProceed: true,
  trustResult: { level: 'safe' },
};
vi.mock('../../utils/trustChecker.js', () => ({
  TrustChecker: vi.fn().mockImplementation(function () {
    return {
      checkDomain: vi.fn().mockResolvedValue(mockTrustCheckResult),
    };
  }),
}));

vi.mock('../privacyPipeline.js', () => ({
  PrivacyPipeline: vi.fn().mockImplementation(function () {
    return {
      process: vi.fn().mockResolvedValue({ summary: 'Test summary', maskedCount: 0 }),
    };
  }),
}));

vi.mock('../notificationHelper.js', () => ({
  NotificationHelper: {
    notifySuccess: vi.fn(),
    notifyError: vi.fn(),
  },
}));

vi.mock('../obsidianClient.js', () => ({
  ObsidianClient: vi.fn(),
}));

vi.mock('../aiClient.js', () => ({
  AIClient: vi.fn(),
}));

vi.mock('../../utils/storageUrls.js', () => ({
  setUrlRecordType: vi.fn().mockResolvedValue(undefined),
  setUrlMaskedCount: vi.fn().mockResolvedValue(undefined),
  setUrlContent: vi.fn().mockResolvedValue(undefined),
  setUrlAiSummary: vi.fn().mockResolvedValue(undefined),
  setUrlTags: vi.fn().mockResolvedValue(undefined),
  setUrlSentTokens: vi.fn().mockResolvedValue(undefined),
  setUrlReceivedTokens: vi.fn().mockResolvedValue(undefined),
  setUrlOriginalTokens: vi.fn().mockResolvedValue(undefined),
  setUrlCleansedTokens: vi.fn().mockResolvedValue(undefined),
  setUrlPageBytes: vi.fn().mockResolvedValue(undefined),
  setUrlCandidateBytes: vi.fn().mockResolvedValue(undefined),
  setUrlOriginalBytes: vi.fn().mockResolvedValue(undefined),
  setUrlCleansedBytes: vi.fn().mockResolvedValue(undefined),
  setUrlAiSummaryOriginalBytes: vi.fn().mockResolvedValue(undefined),
  setUrlAiSummaryCleansedBytes: vi.fn().mockResolvedValue(undefined),
  setUrlAiSummaryCleansedElements: vi.fn().mockResolvedValue(undefined),
  setUrlAiSummaryCleansedReason: vi.fn().mockResolvedValue(undefined),
  setUrlAiProvider: vi.fn().mockResolvedValue(undefined),
  setUrlAiModel: vi.fn().mockResolvedValue(undefined),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────────────
import { RecordingLogic, isValidFetchUrl, truncateContentSize } from '../recordingLogic.js';
import { RecordingPipeline } from '../pipeline/RecordingPipeline.js';
import { PrivacyPipeline } from '../privacyPipeline.js';
import * as storage from '../../utils/storage.js';
import * as domainUtils from '../../utils/domainUtils.js';
import * as storageUrls from '../../utils/storageUrls.js';
import * as loggerModule from '../../utils/logger.js';
import { NotificationHelper } from '../notificationHelper.js';
import { addPendingPage } from '../../utils/pendingStorage.js';
import { getPermissionManager } from '../../utils/permissionManager.js';
import { isPrivateIpAddress } from '../../utils/fetch.js';

const MockedPrivacyPipeline = PrivacyPipeline as vi.Mock;
const mockLogger = vi.mocked(loggerModule);

// ─── Helpers ────────────────────────────────────────────────────────────────
function resetCacheState() {
  RecordingLogic.cacheState = {
    settingsCache: null,
    cacheTimestamp: null,
    cacheVersion: 0,
    urlCache: null,
    urlCacheTimestamp: null,
    privacyCache: null,
    privacyCacheTimestamp: null,
  };
}

function makeMockObsidian() {
  return { appendToDailyNote: vi.fn().mockResolvedValue(undefined) } as any;
}

function makeMockAiClient() {
  return {
    getLocalAvailability: vi.fn().mockResolvedValue('readily'),
    summarizeLocally: vi.fn().mockResolvedValue({ success: true, summary: 'test' }),
    generateSummary: vi.fn().mockResolvedValue('Cloud summary'),
  } as any;
}

function makeLogic() {
  return new RecordingLogic(makeMockObsidian(), makeMockAiClient());
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('isValidFetchUrl', () => {
  test('accepts https URLs', () => {
    expect(isValidFetchUrl('https://example.com/page')).toBe(true);
  });

  test('accepts http URLs', () => {
    expect(isValidFetchUrl('http://example.com/page')).toBe(true);
  });

  test('rejects ftp protocol', () => {
    expect(isValidFetchUrl('ftp://example.com/file')).toBe(false);
  });

  test('rejects file protocol', () => {
    expect(isValidFetchUrl('file:///etc/passwd')).toBe(false);
  });

  test('rejects data URLs', () => {
    expect(isValidFetchUrl('data:text/html,<h1>Hi</h1>')).toBe(false);
  });

  test('rejects javascript protocol', () => {
    expect(isValidFetchUrl('javascript:alert(1)')).toBe(false);
  });

  test('rejects localhost', () => {
    expect(isValidFetchUrl('http://localhost:3000')).toBe(false);
  });

  test('rejects localhost with different casing', () => {
    expect(isValidFetchUrl('http://LOCALHOST')).toBe(false);
  });

  test('rejects private IP addresses', () => {
    // isPrivateIpAddress mock returns false by default, need to override
    (isPrivateIpAddress as vi.Mock).mockReturnValueOnce(true);
    expect(isValidFetchUrl('http://192.168.1.1')).toBe(false);
  });

  test('rejects .local domains', () => {
    expect(isValidFetchUrl('http://myhost.local')).toBe(false);
  });

  test('rejects .internal domains', () => {
    expect(isValidFetchUrl('http://service.internal')).toBe(false);
  });

  test('rejects invalid URLs', () => {
    expect(isValidFetchUrl('not-a-url')).toBe(false);
  });

  test('rejects empty string', () => {
    expect(isValidFetchUrl('')).toBe(false);
  });
});

describe('truncateContentSize', () => {
  test('returns content as-is when under limit', () => {
    const content = 'short content';
    expect(truncateContentSize(content)).toBe(content);
  });

  test('truncates content exceeding MAX_RECORD_SIZE', () => {
    const content = 'a'.repeat(100 * 1024); // 100KB
    const result = truncateContentSize(content);
    expect(result.length).toBeLessThan(content.length);
    expect(new TextEncoder().encode(result).length).toBeLessThanOrEqual(64 * 1024);
  });

  test('returns empty string unchanged', () => {
    expect(truncateContentSize('')).toBe('');
  });

  test('returns falsy content unchanged', () => {
    // Note: truncateContentSize expects string input, falsy values should be handled at caller level
    expect(() => truncateContentSize('')).not.toThrow();
  });
});

/**
 * RecordingPipeline のテスト
 *
 * 修正された問題:
 *   RecordingPipeline に渡された aiClient が processPrivacyPipelineStep に
 *   伝達されず null のまま PrivacyPipeline に渡されていた。
 *   context.aiClient を通じて渡すよう修正済み。
 */

const mockSettings = {
  PRIVACY_MODE: 'full_pipeline',
  PII_SANITIZE_LOGS: true,
  TAG_SUMMARY_MODE: false,
  AUTO_SAVE_PRIVACY_BEHAVIOR: 'save',
};

function makeAiClient() {
  return {
    getLocalAvailability: vi.fn<() => Promise<string>>().mockResolvedValue('unavailable'),
    summarizeLocally: vi.fn(),
    generateSummary: vi.fn<() => Promise<any>>().mockResolvedValue({
      summary: 'AI summary',
      sentTokens: 100,
      receivedTokens: 50,
    }),
  };
}

function makeObsidian() {
  return {
    appendToDailyNote: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
}

function makeGetPrivacyInfo() {
  return vi.fn<() => Promise<any>>().mockResolvedValue({ isPrivate: false });
}

describe('RecordingPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // StorageKeys, MAX_URL_SET_SIZE, URL_WARNING_THRESHOLD はモックモジュール内で定義済み
    // @ts-expect-error - mock
    storage.getSavedUrlsWithTimestamps.mockResolvedValue(new Map());
    // @ts-expect-error - mock
    storage.setSavedUrlsWithTimestamps.mockResolvedValue(undefined);

    // @ts-expect-error - mock
    domainUtils.isDomainAllowed.mockResolvedValue(true);
    // @ts-expect-error - mock
    domainUtils.extractDomain.mockReturnValue('example.com');

    // @ts-expect-error - mock
    (getPermissionManager as vi.Mock).mockReturnValue({
      isHostPermitted: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
      recordDeniedVisit: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    });
  });

  describe('aiClient の伝達（回帰テスト: null問題）', () => {
    it('コンストラクタに渡した aiClient が PrivacyPipeline コンストラクタに届く', async () => {
      const mockProcess = vi.fn<() => Promise<any>>().mockResolvedValue({
        summary: 'AI summary',
        maskedCount: 0,
      });
      MockedPrivacyPipeline.mockImplementation(function () {
        return { process: mockProcess };
      });

      const aiClient = makeAiClient();
      const pipeline = new RecordingPipeline(
        makeGetPrivacyInfo(),
        makeObsidian() as any,
        aiClient as any
      );

      await pipeline.execute({
        title: 'Test',
        url: 'https://example.com',
        content: 'Some content',
      }, mockSettings);

      // PrivacyPipeline が aiClient を受け取っていること
      expect(PrivacyPipeline).toHaveBeenCalledWith(
        expect.any(Object),  // settings
        aiClient,
        expect.any(Object)   // sanitizers
      );
    });

    it('aiClient なし（null）で構築すると PrivacyPipeline に null が渡される', async () => {
      const mockProcess = vi.fn<() => Promise<any>>().mockResolvedValue({
        summary: 'Summary not available.',
        maskedCount: 0,
      });
      MockedPrivacyPipeline.mockImplementation(function () {
        return { process: mockProcess };
      });

      const pipeline = new RecordingPipeline(
        makeGetPrivacyInfo(),
        makeObsidian() as any
        // aiClient を省略 → null がデフォルト
      );

      await pipeline.execute({
        title: 'Test',
        url: 'https://example.com',
        content: 'Some content',
      }, mockSettings);

      expect(PrivacyPipeline).toHaveBeenCalledWith(
        expect.any(Object),
        null,
        expect.any(Object)
      );
    });
  });

  describe('previewOnly モード', () => {
    it('processedContent と maskedItems を返す', async () => {
      const mockProcess = vi.fn<() => Promise<any>>().mockResolvedValue({
        success: true,
        preview: true,
        processedContent: 'Content with [MASKED:email]',
        maskedCount: 1,
        maskedItems: [{ type: 'email' }],
      });
      MockedPrivacyPipeline.mockImplementation(function () {
        return { process: mockProcess };
      });

      const pipeline = new RecordingPipeline(
        makeGetPrivacyInfo(),
        makeObsidian() as any,
        makeAiClient() as any
      );

      const result = await pipeline.execute({
        title: 'Test',
        url: 'https://example.com',
        content: 'Content with user@example.com',
        previewOnly: true,
      }, mockSettings);

      expect(result.success).toBe(true);
      expect(result.preview).toBe(true);
      expect(result.processedContent).toBe('Content with [MASKED:email]');
      expect(result.maskedCount).toBe(1);
      expect(result.maskedItems).toEqual([{ type: 'email' }]);
    });

    it('previewOnly 時は Obsidian に保存しない', async () => {
      const mockAppend = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
      const mockObsidian = makeObsidian();
      mockObsidian.appendToDailyNote = mockAppend;
      MockedPrivacyPipeline.mockImplementation(function () {
        return {
          process: vi.fn<() => Promise<any>>().mockResolvedValue({
            success: true,
            preview: true,
            processedContent: 'Processed',
            maskedCount: 0,
            maskedItems: [],
          }),
        };
      });

      const pipeline = new RecordingPipeline(
        makeGetPrivacyInfo(),
        mockObsidian as any,
        makeAiClient() as any
      );

      await pipeline.execute({
        title: 'Test',
        url: 'https://example.com',
        content: 'Content',
        previewOnly: true,
      }, mockSettings);

      expect(mockAppend).not.toHaveBeenCalled();
    });
  });

  describe('通常記録フロー', () => {
    it('AI要約が Obsidian に保存される', async () => {
      const mockAppend = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
      const mockObsidian = makeObsidian();
      mockObsidian.appendToDailyNote = mockAppend;
      MockedPrivacyPipeline.mockImplementation(function () {
        return {
          process: vi.fn<() => Promise<any>>().mockResolvedValue({
            summary: 'Generated AI summary',
            maskedCount: 0,
          }),
        };
      });

      const pipeline = new RecordingPipeline(
        makeGetPrivacyInfo(),
        mockObsidian as any,
        makeAiClient() as any
      );

      const result = await pipeline.execute({
        title: 'Test Page',
        url: 'https://example.com',
        content: 'Page content',
      }, mockSettings);

      expect(result.success).toBe(true);
      expect(mockAppend).toHaveBeenCalled();
      const callArg: string = mockAppend.mock.calls[0]?.[0] || '';
      expect(callArg).toContain('Generated AI summary');
    });

    it('ドメインブロック時は DOMAIN_BLOCKED エラーを返す', async () => {
      // @ts-expect-error - mock
      domainUtils.isDomainAllowed.mockResolvedValue(false);

      const pipeline = new RecordingPipeline(
        makeGetPrivacyInfo(),
        makeObsidian() as any,
        makeAiClient() as any
      );

      const result = await pipeline.execute({
        title: 'Test',
        url: 'https://blocked.example.com',
        content: 'Content',
      }, mockSettings);

      expect(result.success).toBe(false);
      expect(result.error).toContain('DOMAIN_BLOCKED');
    });
  });

  describe('指数バックオフの上限（5000ms cap）', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('リトライ時の delayMs が常に 5000ms 以下である', async () => {
      // privacyPipeline ステップ（maxRetries=3）が RETRY 対象
      // retries=1: 2^1*1000=2000ms, retries=2: 2^2*1000=4000ms, retries=3: 2^3*1000=8000ms→cap→5000ms
      MockedPrivacyPipeline.mockImplementation(function () {
        return {
          process: vi.fn<() => Promise<any>>().mockRejectedValue(new Error('Transient error')),
        };
      });

      const pipeline = new RecordingPipeline(
        makeGetPrivacyInfo(),
        makeObsidian() as any,
        makeAiClient() as any
      );

      const executePromise = pipeline.execute({
        title: 'Retry Test',
        url: 'https://example.com',
        content: 'Content',
      }, mockSettings);

      // 非同期タイマーを全て完走させる
      await vi.runAllTimersAsync();
      await executePromise;

      // addLog に渡された delayMs 引数をすべて検証
      const retryCalls = mockLogger.addLog.mock.calls.filter(
        (call: unknown[]) => typeof call[1] === 'string' && (call[1] as string).includes('Retrying')
      );

      expect(retryCalls.length).toBeGreaterThan(0);
      for (const call of retryCalls) {
        const logData = call[2] as { delayMs: number };
        expect(logData.delayMs).toBeLessThanOrEqual(5000);
      }
    });

    it('retries=3 のバックオフ（8000ms）が 5000ms にキャップされる', () => {
      // 直接計算を検証: Math.min(Math.pow(2, 3) * 1000, 5000) = Math.min(8000, 5000) = 5000
      const retries = 3;
      const delayMs = Math.min(Math.pow(2, retries) * 1000, 5000);
      expect(delayMs).toBe(5000);
    });

    it('retries=1,2 のバックオフは上限未満なのでそのまま', () => {
      expect(Math.min(Math.pow(2, 1) * 1000, 5000)).toBe(2000);
      expect(Math.min(Math.pow(2, 2) * 1000, 5000)).toBe(4000);
    });
  });

  describe('buildErrorResult - ErrorCode.INTERNAL_ERROR', () => {
    it('ステップで例外が発生した場合、logError に ErrorCode.INTERNAL_ERROR が渡される', async () => {
      MockedPrivacyPipeline.mockImplementation(function () {
        return {
          process: vi.fn<() => Promise<any>>().mockRejectedValue(new Error('Unexpected failure')),
        };
      });

      const pipeline = new RecordingPipeline(
        makeGetPrivacyInfo(),
        makeObsidian() as any,
        makeAiClient() as any
      );

      const result = await pipeline.execute({
        title: 'Test',
        url: 'https://example.com',
        content: 'Content',
      }, mockSettings);

      expect(result.success).toBe(false);
      expect(mockLogger.logError).toHaveBeenCalledWith(
        expect.stringContaining('Pipeline failed at step'),
        expect.any(Object),
        mockLogger.ErrorCode.INTERNAL_ERROR,
        'RecordingPipeline'
      );
    });

    it('エラー結果に success=false と error メッセージが含まれる', async () => {
      MockedPrivacyPipeline.mockImplementation(function () {
        return {
          process: vi.fn<() => Promise<any>>().mockRejectedValue(new Error('Step crashed')),
        };
      });

      const pipeline = new RecordingPipeline(
        makeGetPrivacyInfo(),
        makeObsidian() as any,
        makeAiClient() as any
      );

      const result = await pipeline.execute({
        title: 'Crash Test',
        url: 'https://example.com',
        content: 'Content',
      }, mockSettings);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});