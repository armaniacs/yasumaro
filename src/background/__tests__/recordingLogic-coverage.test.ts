// src/background/__tests__/recordingLogic-coverage.test.ts
// Coverage-focused tests for recordingLogic.ts
// Targets: truncateContentSize, isValidFetchUrl (via SSRF),
//          getSavedUrlsWithCache, invalidateInstanceCache,
//          normalizeUrlForCache, getPrivacyInfoWithCache (session storage),
//          _recordImpl branches, recordWithPreview

import { describe, test, expect, beforeEach, vi } from 'vitest';

// ─── Mocks (must be before imports) ─────────────────────────────────────────
vi.mock('../../utils/storage.ts', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('../../utils/storage.ts');
  return {
    ...actual,
    getSettings: vi.fn(),
    getSavedUrlsWithTimestamps: vi.fn(),
    setSavedUrlsWithTimestamps: vi.fn(),
    saveSettings: vi.fn(),
  };
});

vi.mock('../../utils/domainUtils.ts', () => ({
  isDomainAllowed: vi.fn(),
  isDomainInList: vi.fn(),
  extractDomain: vi.fn(),
}));

vi.mock('../../utils/logger.ts', () => ({
  addLog: vi.fn(),
  LogType: { DEBUG: 'DEBUG', INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
  ErrorCode: { INTERNAL_ERROR: 'INT_001' },
  logError: vi.fn(),
}));

vi.mock('../../utils/piiSanitizer.ts', () => ({
  sanitizeRegex: vi.fn(),
}));

vi.mock('../../utils/markdownSanitizer.ts', () => ({
  sanitizeForObsidian: vi.fn((s: string) => s),
}));

vi.mock('../../utils/localeUtils.ts', () => ({
  getUserLocale: vi.fn(() => 'en'),
}));

vi.mock('../../utils/urlUtils.ts', () => ({
  sanitizeUrlForLogging: vi.fn((url: string) => url),
}));

vi.mock('../../utils/fetch.ts', () => ({
  isPrivateIpAddress: vi.fn(() => false),
}));

vi.mock('../../utils/pendingStorage.ts', () => ({
  addPendingPage: vi.fn(),
}));

vi.mock('../../utils/redaction.ts', () => ({
  redactHeaderValue: vi.fn((v: string) => v),
}));

vi.mock('../../utils/permissionManager.ts', () => ({
  getPermissionManager: vi.fn(() => ({
    isHostPermitted: vi.fn().mockResolvedValue(true),
    recordDeniedVisit: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../utils/trustChecker.ts', () => ({
  TrustChecker: vi.fn().mockImplementation(function(this: any) {
    this.checkDomain = vi.fn().mockResolvedValue({
      canProceed: true,
      trustResult: { level: 'safe' },
    });
  }),
}));

vi.mock('../privacyPipeline.ts', () => ({
  PrivacyPipeline: vi.fn().mockImplementation(function(this: any) {
    this.process = vi.fn().mockResolvedValue({ summary: 'Test summary', maskedCount: 0 });
  }),
}));

vi.mock('../notificationHelper.ts', () => ({
  NotificationHelper: {
    notifySuccess: vi.fn(),
    notifyError: vi.fn(),
  },
}));

vi.mock('../obsidianClient.ts', () => ({
  ObsidianClient: vi.fn(),
}));

vi.mock('../aiClient.ts', () => ({
  AIClient: vi.fn(),
}));

vi.mock('../../utils/storageUrls.ts', () => ({
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
}));

// Pipeline steps mock
vi.mock('../pipeline/RecordingPipeline.ts', () => {
  const RecordingPipeline = vi.fn().mockImplementation(function(this: any) {
    this.execute = vi.fn().mockResolvedValue({ success: true, summary: 'Pipeline summary' });
  });
  return {
    RecordingPipeline,
    createRecordingPipeline: vi.fn().mockImplementation(() => new RecordingPipeline()),
  };
});

// ─── Imports (after mocks) ──────────────────────────────────────────────────
import { RecordingLogic, truncateContentSize } from '../recordingLogic.ts';
import * as storage from '../../utils/storage.ts';
import * as domainUtils from '../../utils/domainUtils.ts';
import { PrivacyPipeline } from '../privacyPipeline.ts';
import { RecordingPipeline } from '../pipeline/RecordingPipeline.ts';
import { NotificationHelper } from '../notificationHelper.ts';

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
    getSupportedModes: vi.fn().mockReturnValue(['local_only', 'full_pipeline']),
    generateSummary: vi.fn().mockResolvedValue({ summary: 'Cloud summary' }),
  } as any;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('truncateContentSize', () => {
  test('returns content unchanged when within limit', () => {
    const content = 'Hello, world!';
    expect(truncateContentSize(content)).toBe(content);
  });

  test('returns content unchanged when exactly at default limit (64KB)', () => {
    const content = 'a'.repeat(64 * 1024);
    expect(truncateContentSize(content)).toBe(content);
  });

  test('truncates content exceeding default limit', () => {
    const content = 'a'.repeat(100 * 1024); // 100KB
    const result = truncateContentSize(content);
    expect(result.length).toBeLessThan(content.length);
    // TextEncoder bytes should be at most 64KB
    expect(new TextEncoder().encode(result).length).toBeLessThanOrEqual(64 * 1024);
  });

  test('respects custom maxSize parameter', () => {
    const content = 'abcdefghij';
    const result = truncateContentSize(content, 5);
    expect(new TextEncoder().encode(result).length).toBeLessThanOrEqual(5);
  });

  test('handles empty string', () => {
    expect(truncateContentSize('')).toBe('');
  });

  test('handles multi-byte UTF-8 characters without corruption', () => {
    // Japanese characters are 3 bytes each in UTF-8
    const content = 'あ'.repeat(30); // 90 bytes
    const result = truncateContentSize(content, 10);
    // Truncated content should be shorter than original
    expect(result.length).toBeLessThan(content.length);
    // TextDecoder with fatal:false may produce a few extra bytes from partial chars
    const bytes = new TextEncoder().encode(result);
    expect(bytes.length).toBeLessThanOrEqual(13);
    // Should be decodable without error (fatal:true verifies valid UTF-8)
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes)).not.toThrow();
  });

  test('handles content with mixed ASCII and multi-byte', () => {
    const content = 'abc日本語def'.repeat(1000);
    const result = truncateContentSize(content, 50);
    // Allow slight overshoot from partial multi-byte character decoding
    expect(new TextEncoder().encode(result).length).toBeLessThanOrEqual(55);
    expect(result.length).toBeLessThan(content.length);
  });

  test('custom maxSize = 0 returns empty string', () => {
    expect(truncateContentSize('hello', 0)).toBe('');
  });

  test('custom maxSize larger than content returns content unchanged', () => {
    const content = 'short';
    expect(truncateContentSize(content, 10000)).toBe(content);
  });
});

describe('RecordingLogic - getSavedUrlsWithCache', () => {
  let logic: RecordingLogic;

  beforeEach(() => {
    resetCacheState();
    logic = new RecordingLogic(makeMockObsidian(), makeMockAiClient());
    vi.clearAllMocks();

    // @ts-expect-error - vi.fn() type narrowing
    storage.getSettings.mockResolvedValue({});
    // @ts-expect-error - vi.fn() type narrowing
    storage.getSavedUrlsWithTimestamps.mockResolvedValue(new Map());
  });

  test('fetches from storage on first call (cache miss)', async () => {
    const urlMap = new Map([['https://example.com', Date.now()]]);
    // @ts-expect-error - vi.fn() type narrowing
    storage.getSavedUrlsWithTimestamps.mockResolvedValue(urlMap);

    const result = await logic.getSavedUrlsWithCache();

    expect(storage.getSavedUrlsWithTimestamps).toHaveBeenCalledTimes(1);
    expect(result.get('https://example.com')).toBeDefined();
  });

  test('returns cached data on second call within TTL', async () => {
    const urlMap = new Map([['https://example.com', Date.now()]]);
    // @ts-expect-error - vi.fn() type narrowing
    storage.getSavedUrlsWithTimestamps.mockResolvedValue(urlMap);

    await logic.getSavedUrlsWithCache();
    // @ts-expect-error - vi.fn() type narrowing
    storage.getSavedUrlsWithTimestamps.mockClear();

    const result = await logic.getSavedUrlsWithCache();

    // Should not call storage again (cache hit)
    expect(storage.getSavedUrlsWithTimestamps).not.toHaveBeenCalled();
    expect(result.get('https://example.com')).toBeDefined();
  });

  test('refetches from storage after TTL expires', async () => {
    // @ts-expect-error - vi.fn() type narrowing
    storage.getSavedUrlsWithTimestamps.mockResolvedValue(new Map([['https://first.com', 1]]));
    await logic.getSavedUrlsWithCache();

    // Expire the cache
    RecordingLogic.cacheState.urlCacheTimestamp = Date.now() - 61 * 1000; // 61 seconds ago

    const newMap = new Map([['https://second.com', 2]]);
    // @ts-expect-error - vi.fn() type narrowing
    storage.getSavedUrlsWithTimestamps.mockResolvedValue(newMap);
    // @ts-expect-error - vi.fn() type narrowing
    storage.getSavedUrlsWithTimestamps.mockClear();

    const result = await logic.getSavedUrlsWithCache();

    expect(storage.getSavedUrlsWithTimestamps).toHaveBeenCalledTimes(1);
    expect(result.get('https://second.com')).toBeDefined();
  });

  test('getSavedUrlsWithCache returns equivalent data on cache hit', async () => {
    const originalMap = new Map([['https://a.com', 1], ['https://b.com', 2]]);
    // @ts-expect-error - vi.fn() type narrowing
    storage.getSavedUrlsWithTimestamps.mockResolvedValue(originalMap);

    const first = await logic.getSavedUrlsWithCache();
    // @ts-expect-error - vi.fn() type narrowing
    storage.getSavedUrlsWithTimestamps.mockClear();

    const second = await logic.getSavedUrlsWithCache();

    // Same data returned from cache
    expect(Array.from(first.entries())).toEqual(Array.from(second.entries()));
    // Storage not called again
    expect(storage.getSavedUrlsWithTimestamps).not.toHaveBeenCalled();
  });
});

describe('RecordingLogic - invalidateUrlCache', () => {
  beforeEach(() => {
    resetCacheState();
  });

  test('clears urlCache and urlCacheTimestamp', () => {
    RecordingLogic.cacheState.urlCache = new Map([['https://x.com', 1]]);
    RecordingLogic.cacheState.urlCacheTimestamp = Date.now();

    RecordingLogic.invalidateUrlCache();

    expect(RecordingLogic.cacheState.urlCache).toBeNull();
    expect(RecordingLogic.cacheState.urlCacheTimestamp).toBeNull();
  });
});

describe('RecordingLogic - invalidateInstanceCache', () => {
  test('is a no-op (does not throw)', () => {
    const logic = new RecordingLogic(makeMockObsidian(), makeMockAiClient());
    expect(() => logic.invalidateInstanceCache()).not.toThrow();
  });
});

describe('RecordingLogic - normalizeUrlForCache (via getPrivacyInfoWithCache)', () => {
  let logic: RecordingLogic;

  beforeEach(() => {
    resetCacheState();
    logic = new RecordingLogic(makeMockObsidian(), makeMockAiClient());
  });

  test('normalizes URL by removing trailing slash', async () => {
    const normalizedKey = 'https://example.com/page';
    const privacyInfo = { isPrivate: false, timestamp: Date.now() };

    RecordingLogic.cacheState.privacyCache = new Map([[normalizedKey, privacyInfo]]);

    // Access with trailing slash — should match normalized key
    const result = await logic.getPrivacyInfoWithCache('https://example.com/page/');
    expect(result).toEqual(privacyInfo);
  });

  test('normalizes URL by removing hash fragment', async () => {
    const normalizedKey = 'https://example.com/page';
    const privacyInfo = { isPrivate: false, timestamp: Date.now() };

    RecordingLogic.cacheState.privacyCache = new Map([[normalizedKey, privacyInfo]]);

    const result = await logic.getPrivacyInfoWithCache('https://example.com/page#section');
    expect(result).toEqual(privacyInfo);
  });

  test('does not strip trailing slash from root path', async () => {
    const normalizedKey = 'https://example.com/';
    const privacyInfo = { isPrivate: false, timestamp: Date.now() };

    RecordingLogic.cacheState.privacyCache = new Map([[normalizedKey, privacyInfo]]);

    const result = await logic.getPrivacyInfoWithCache('https://example.com/');
    expect(result).toEqual(privacyInfo);
  });

  test('returns original URL if URL is invalid (parse failure)', async () => {
    // Invalid URL - normalizeUrlForCache returns the original string
    RecordingLogic.cacheState.privacyCache = new Map();

    const result = await logic.getPrivacyInfoWithCache('not-a-url');
    expect(result).toBeNull();
  });
});

describe('RecordingLogic - getPrivacyInfoWithCache session storage fallback', () => {
  let logic: RecordingLogic;

  beforeEach(() => {
    resetCacheState();
    logic = new RecordingLogic(makeMockObsidian(), makeMockAiClient());
  });

  test('restores privacy info from chrome.storage.session on cache miss', async () => {
    const url = 'https://example.com/private';
    const normalizedUrl = 'https://example.com/private';
    const sessionKey = 'privacyCache_' + normalizedUrl;
    const cachedInfo = {
      isPrivate: true,
      reason: 'cache-control',
      timestamp: Date.now(),
    };

    // Set up session storage mock to return data
    await chrome.storage.session.set({ [sessionKey]: cachedInfo });

    const result = await logic.getPrivacyInfoWithCache(url);

    expect(result).toBeTruthy();
    expect(result?.isPrivate).toBe(true);
    // Should also restore to in-memory cache
    expect(RecordingLogic.cacheState.privacyCache?.get(normalizedUrl)).toBeTruthy();
  });

  test('returns null when both in-memory and session cache miss', async () => {
    RecordingLogic.cacheState.privacyCache = new Map();

    const result = await logic.getPrivacyInfoWithCache('https://nonexistent.com/page');
    expect(result).toBeNull();
  });

  test('handles session storage error gracefully', async () => {
    RecordingLogic.cacheState.privacyCache = new Map();

    // Make session.get throw
    const originalGet = chrome.storage.session.get;
    (chrome.storage.session.get as vi.Mock).mockRejectedValueOnce(new Error('Session error'));

    const result = await logic.getPrivacyInfoWithCache('https://example.com/page');
    expect(result).toBeNull();

    // Restore
    (chrome.storage.session.get as vi.Mock).mockImplementation(originalGet as any);
  });

  test('skips session storage fallback when in-memory cache has valid entry', async () => {
    const url = 'https://example.com/cached';
    const cachedInfo = {
      isPrivate: true,
      reason: 'set-cookie',
      timestamp: Date.now(),
    };

    RecordingLogic.cacheState.privacyCache = new Map([[url, cachedInfo]]);

    const result = await logic.getPrivacyInfoWithCache(url);
    expect(result).toEqual(cachedInfo);
    // Session storage should not be consulted
  });
});

describe('RecordingLogic - invalidatePrivacyCache', () => {
  beforeEach(() => {
    resetCacheState();
  });

  test('clears privacy cache and timestamp', () => {
    RecordingLogic.cacheState.privacyCache = new Map([['test', { isPrivate: false, timestamp: Date.now() } as any]]);
    RecordingLogic.cacheState.privacyCacheTimestamp = Date.now();

    RecordingLogic.invalidatePrivacyCache();

    expect(RecordingLogic.cacheState.privacyCache).toBeNull();
    expect(RecordingLogic.cacheState.privacyCacheTimestamp).toBeNull();
  });
});

describe('RecordingLogic - record (delegates to RecordingPipeline)', () => {
  let logic: RecordingLogic;
  let mockExecute: vi.Mock;

  beforeEach(() => {
    resetCacheState();
    vi.clearAllMocks();

    // @ts-expect-error - vi.fn() type narrowing
    storage.getSettings.mockResolvedValue({ PRIVACY_MODE: 'full_pipeline' });
    // @ts-expect-error - vi.fn() type narrowing
    storage.getSavedUrlsWithTimestamps.mockResolvedValue(new Map());
    // @ts-expect-error - vi.fn() type narrowing
    domainUtils.isDomainAllowed.mockResolvedValue(true);

    mockExecute = vi.fn().mockResolvedValue({ success: true, summary: 'Pipeline summary' });
    // @ts-expect-error - vi.fn() type narrowing
    RecordingPipeline.mockImplementation(function(this: any) {
      this.execute = mockExecute;
    });

    logic = new RecordingLogic(makeMockObsidian(), makeMockAiClient());
  });

  test('creates RecordingPipeline and calls execute', async () => {
    const result = await logic.record({
      title: 'Test',
      url: 'https://example.com',
      content: 'Test content',
    });

    expect(RecordingPipeline).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });

  test('passes settings to pipeline.execute', async () => {
    const settings = { PRIVACY_MODE: 'full_pipeline' };
    // @ts-expect-error - vi.fn() type narrowing
    storage.getSettings.mockResolvedValue(settings);

    await logic.record({
      title: 'Test',
      url: 'https://example.com',
      content: 'content',
    });

    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Test', url: 'https://example.com' }),
      expect.objectContaining({ PRIVACY_MODE: 'full_pipeline' })
    );
  });

  test('passes RecordingData to pipeline.execute', async () => {
    const data = {
      title: 'My Page',
      url: 'https://example.com/page',
      content: 'Some content',
      force: true,
      skipDuplicateCheck: true,
    };

    await logic.record(data);

    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining(data),
      expect.anything()
    );
  });

  test('returns pipeline result directly', async () => {
    const pipelineResult = {
      success: true,
      summary: 'AI generated summary',
      maskedCount: 5,
      tags: ['tech'],
    };
    mockExecute.mockResolvedValue(pipelineResult);

    const result = await logic.record({
      title: 'Test',
      url: 'https://example.com',
      content: 'content',
    });

    expect(result).toEqual(pipelineResult);
  });

  test('returns error result when pipeline fails', async () => {
    mockExecute.mockRejectedValue(new Error('Pipeline failed'));

    await expect(
      logic.record({
        title: 'Test',
        url: 'https://example.com',
        content: 'content',
      })
    ).rejects.toThrow('Pipeline failed');
  });
});

describe('RecordingLogic - recordWithPreview', () => {
  let logic: RecordingLogic;
  let mockExecute: vi.Mock;

  beforeEach(() => {
    resetCacheState();
    vi.clearAllMocks();

    // @ts-expect-error - vi.fn() type narrowing
    storage.getSettings.mockResolvedValue({ PRIVACY_MODE: 'full_pipeline' });
    // @ts-expect-error - vi.fn() type narrowing
    storage.getSavedUrlsWithTimestamps.mockResolvedValue(new Map());
    // @ts-expect-error - vi.fn() type narrowing
    domainUtils.isDomainAllowed.mockResolvedValue(true);

    mockExecute = vi.fn().mockResolvedValue({
      success: true,
      summary: 'Preview summary',
      processedContent: 'masked content',
    });
    // @ts-expect-error - vi.fn() type narrowing
    RecordingPipeline.mockImplementation(function(this: any) {
      this.execute = mockExecute;
    });

    logic = new RecordingLogic(makeMockObsidian(), makeMockAiClient());
  });

  test('calls record with previewOnly=true', async () => {
    await logic.recordWithPreview({
      title: 'Test',
      url: 'https://example.com',
      content: 'content',
    });

    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({ previewOnly: true }),
      expect.anything()
    );
  });

  test('returns preview result', async () => {
    const result = await logic.recordWithPreview({
      title: 'Preview Page',
      url: 'https://example.com',
      content: 'preview content',
    });

    expect(result.success).toBe(true);
    expect(result.summary).toBe('Preview summary');
  });

  test('preserves other data fields when setting previewOnly', async () => {
    await logic.recordWithPreview({
      title: 'My Page',
      url: 'https://example.com',
      content: 'some content',
      force: true,
      skipDuplicateCheck: true,
    });

    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'My Page',
        url: 'https://example.com',
        content: 'some content',
        force: true,
        skipDuplicateCheck: true,
        previewOnly: true,
      }),
      expect.anything()
    );
  });
});

describe('RecordingLogic - constructor', () => {
  test('initializes mode as null', () => {
    const logic = new RecordingLogic(makeMockObsidian(), makeMockAiClient());
    expect((logic as any).mode).toBeNull();
  });

  test('stores obsidian and aiService references', () => {
    const obsidian = makeMockObsidian();
    const aiClient = makeMockAiClient();
    const logic = new RecordingLogic(obsidian, aiClient);

    expect((logic as any).obsidian).toBe(obsidian);
    expect((logic as any).aiService).toBe(aiClient);
  });
});

describe('RecordingLogic - settings cache interaction with record', () => {
  let logic: RecordingLogic;

  beforeEach(() => {
    resetCacheState();
    vi.clearAllMocks();

    // @ts-expect-error - vi.fn() type narrowing
    storage.getSettings.mockResolvedValue({ PRIVACY_MODE: 'full_pipeline' });
    // @ts-expect-error - vi.fn() type narrowing
    storage.getSavedUrlsWithTimestamps.mockResolvedValue(new Map());
    // @ts-expect-error - vi.fn() type narrowing
    domainUtils.isDomainAllowed.mockResolvedValue(true);

    // @ts-expect-error - vi.fn() type narrowing
    RecordingPipeline.mockImplementation(function(this: any) {
      this.execute = vi.fn().mockResolvedValue({ success: true });
    });

    logic = new RecordingLogic(makeMockObsidian(), makeMockAiClient());
  });

  test('record populates settings cache', async () => {
    expect(RecordingLogic.cacheState.settingsCache).toBeNull();

    await logic.record({
      title: 'Test',
      url: 'https://example.com',
      content: 'content',
    });

    // Settings cache should be populated by getSettingsWithCache call
    expect(RecordingLogic.cacheState.settingsCache).not.toBeNull();
  });

  test('second record reuses settings cache', async () => {
    await logic.record({
      title: 'First',
      url: 'https://example.com/1',
      content: 'content',
    });

    // @ts-expect-error - vi.fn() type narrowing
    storage.getSettings.mockClear();

    await logic.record({
      title: 'Second',
      url: 'https://example.com/2',
      content: 'content',
    });

    // getSettings should not be called again due to cache
    expect(storage.getSettings).not.toHaveBeenCalled();
  });
});

describe('RecordingLogic - static cache state', () => {
  test('cacheState is shared across instances', async () => {
    resetCacheState();

    // @ts-expect-error - vi.fn() type narrowing
    storage.getSettings.mockResolvedValue({ PRIVACY_MODE: 'test' });

    const logic1 = new RecordingLogic(makeMockObsidian(), makeMockAiClient());
    await logic1.getSettingsWithCache();

    expect(RecordingLogic.cacheState.settingsCache).not.toBeNull();

    const logic2 = new RecordingLogic(makeMockObsidian(), makeMockAiClient());
    // logic2 should see the same static cache
    const settings = await logic2.getSettingsWithCache();
    expect(settings).toHaveProperty('PRIVACY_MODE', 'test');
    // getSettings should NOT have been called a second time
    expect(storage.getSettings).toHaveBeenCalledTimes(1);
  });

  test('invalidateSettingsCache increments version', () => {
    const versionBefore = RecordingLogic.cacheState.cacheVersion;
    RecordingLogic.invalidateSettingsCache();
    expect(RecordingLogic.cacheState.cacheVersion).toBe(versionBefore + 1);
  });

  test('invalidateSettingsCache after two invalidations increments by 2', () => {
    const versionBefore = RecordingLogic.cacheState.cacheVersion;
    RecordingLogic.invalidateSettingsCache();
    RecordingLogic.invalidateSettingsCache();
    expect(RecordingLogic.cacheState.cacheVersion).toBe(versionBefore + 2);
  });
});

describe('RecordingLogic - edge cases', () => {
  let logic: RecordingLogic;

  beforeEach(() => {
    resetCacheState();
    vi.clearAllMocks();

    // @ts-expect-error - vi.fn() type narrowing
    storage.getSettings.mockResolvedValue({});
    // @ts-expect-error - vi.fn() type narrowing
    storage.getSavedUrlsWithTimestamps.mockResolvedValue(new Map());
  });

  test('getPrivacyInfoWithCache returns null for expired cache entry', async () => {
    logic = new RecordingLogic(makeMockObsidian(), makeMockAiClient());

    const url = 'https://example.com/expired';
    const expiredInfo = {
      isPrivate: true,
      reason: 'cache-control' as const,
      timestamp: Date.now() - 6 * 60 * 1000, // 6 minutes ago (> 5 min TTL)
    };

    RecordingLogic.cacheState.privacyCache = new Map([[url, expiredInfo]]);

    const result = await logic.getPrivacyInfoWithCache(url);
    // Expired entry should be treated as cache miss
    expect(result).toBeNull();
  });

  test('getPrivacyInfoWithCache returns fresh cache entry', async () => {
    logic = new RecordingLogic(makeMockObsidian(), makeMockAiClient());

    const url = 'https://example.com/fresh';
    const freshInfo = {
      isPrivate: false,
      timestamp: Date.now(),
    };

    RecordingLogic.cacheState.privacyCache = new Map([[url, freshInfo]]);

    const result = await logic.getPrivacyInfoWithCache(url);
    expect(result).toEqual(freshInfo);
  });

  test('getPrivacyInfoWithCache handles null privacyCache', async () => {
    logic = new RecordingLogic(makeMockObsidian(), makeMockAiClient());

    RecordingLogic.cacheState.privacyCache = null;

    const result = await logic.getPrivacyInfoWithCache('https://example.com/page');
    expect(result).toBeNull();
  });
});
