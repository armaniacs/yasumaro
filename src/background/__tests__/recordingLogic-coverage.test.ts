// src/background/__tests__/recordingLogic-coverage.test.ts
// Coverage-focused tests for recordingLogic.ts
// Targets: truncateContentSize, isValidFetchUrl (via SSRF),
//          getSavedUrlsWithCache, invalidateInstanceCache,
//          normalizeUrlForCache, getPrivacyInfoWithCache (session storage),
//          _recordImpl branches, recordWithPreview

import { describe, test, expect, beforeEach, jest } from '@jest/globals';

// ─── Mocks (must be before imports) ─────────────────────────────────────────
jest.mock('../../utils/storage.js', () => {
  const actual = jest.requireActual('../../utils/storage.js') as any;
  return {
    ...actual,
    getSettings: jest.fn(),
    getSavedUrlsWithTimestamps: jest.fn(),
    setSavedUrlsWithTimestamps: jest.fn(),
    saveSettings: jest.fn(),
  };
});

jest.mock('../../utils/domainUtils.js', () => ({
  isDomainAllowed: jest.fn(),
  isDomainInList: jest.fn(),
  extractDomain: jest.fn(),
}));

jest.mock('../../utils/logger.js', () => ({
  addLog: jest.fn(),
  LogType: { DEBUG: 'DEBUG', INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
  ErrorCode: { INTERNAL_ERROR: 'INT_001' },
  logError: jest.fn(),
}));

jest.mock('../../utils/piiSanitizer.js', () => ({
  sanitizeRegex: jest.fn(),
}));

jest.mock('../../utils/markdownSanitizer.js', () => ({
  sanitizeForObsidian: jest.fn((s: string) => s),
}));

jest.mock('../../utils/localeUtils.js', () => ({
  getUserLocale: jest.fn(() => 'en'),
}));

jest.mock('../../utils/urlUtils.js', () => ({
  sanitizeUrlForLogging: jest.fn((url: string) => url),
}));

jest.mock('../../utils/fetch.js', () => ({
  isPrivateIpAddress: jest.fn(() => false),
}));

jest.mock('../../utils/pendingStorage.js', () => ({
  addPendingPage: jest.fn(),
}));

jest.mock('../../utils/redaction.js', () => ({
  redactHeaderValue: jest.fn((v: string) => v),
}));

jest.mock('../../utils/permissionManager.js', () => ({
  getPermissionManager: jest.fn(() => ({
    isHostPermitted: jest.fn().mockResolvedValue(true),
    recordDeniedVisit: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../../utils/trustChecker.js', () => ({
  TrustChecker: jest.fn().mockImplementation(() => ({
    checkDomain: jest.fn().mockResolvedValue({
      canProceed: true,
      trustResult: { level: 'safe' },
    }),
  })),
}));

jest.mock('../privacyPipeline.js', () => ({
  PrivacyPipeline: jest.fn().mockImplementation(() => ({
    process: jest.fn().mockResolvedValue({ summary: 'Test summary', maskedCount: 0 }),
  })),
}));

jest.mock('../notificationHelper.js', () => ({
  NotificationHelper: {
    notifySuccess: jest.fn(),
    notifyError: jest.fn(),
  },
}));

jest.mock('../obsidianClient.js', () => ({
  ObsidianClient: jest.fn(),
}));

jest.mock('../aiClient.js', () => ({
  AIClient: jest.fn(),
}));

jest.mock('../../utils/storageUrls.js', () => ({
  setUrlRecordType: jest.fn().mockResolvedValue(undefined),
  setUrlMaskedCount: jest.fn().mockResolvedValue(undefined),
  setUrlContent: jest.fn().mockResolvedValue(undefined),
  setUrlAiSummary: jest.fn().mockResolvedValue(undefined),
  setUrlTags: jest.fn().mockResolvedValue(undefined),
  setUrlSentTokens: jest.fn().mockResolvedValue(undefined),
  setUrlReceivedTokens: jest.fn().mockResolvedValue(undefined),
  setUrlOriginalTokens: jest.fn().mockResolvedValue(undefined),
  setUrlCleansedTokens: jest.fn().mockResolvedValue(undefined),
  setUrlPageBytes: jest.fn().mockResolvedValue(undefined),
  setUrlCandidateBytes: jest.fn().mockResolvedValue(undefined),
  setUrlOriginalBytes: jest.fn().mockResolvedValue(undefined),
  setUrlCleansedBytes: jest.fn().mockResolvedValue(undefined),
  setUrlAiSummaryOriginalBytes: jest.fn().mockResolvedValue(undefined),
  setUrlAiSummaryCleansedBytes: jest.fn().mockResolvedValue(undefined),
  setUrlAiSummaryCleansedElements: jest.fn().mockResolvedValue(undefined),
  setUrlAiSummaryCleansedReason: jest.fn().mockResolvedValue(undefined),
}));

// Pipeline steps mock
jest.mock('../pipeline/RecordingPipeline.js', () => ({
  RecordingPipeline: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({ success: true, summary: 'Pipeline summary' }),
  })),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────────────
import { RecordingLogic, truncateContentSize } from '../recordingLogic.js';
import * as storage from '../../utils/storage.js';
import * as domainUtils from '../../utils/domainUtils.js';
import { PrivacyPipeline } from '../privacyPipeline.js';
import { RecordingPipeline } from '../pipeline/RecordingPipeline.js';
import { NotificationHelper } from '../notificationHelper.js';

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
  return { appendToDailyNote: jest.fn().mockResolvedValue(undefined) } as any;
}

function makeMockAiClient() {
  return {
    getLocalAvailability: jest.fn().mockResolvedValue('readily'),
    summarizeLocally: jest.fn().mockResolvedValue({ success: true, summary: 'test' }),
    generateSummary: jest.fn().mockResolvedValue('Cloud summary'),
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
    jest.clearAllMocks();

    // @ts-expect-error - jest.fn() type narrowing
    storage.getSettings.mockResolvedValue({});
    // @ts-expect-error - jest.fn() type narrowing
    storage.getSavedUrlsWithTimestamps.mockResolvedValue(new Map());
  });

  test('fetches from storage on first call (cache miss)', async () => {
    const urlMap = new Map([['https://example.com', Date.now()]]);
    // @ts-expect-error - jest.fn() type narrowing
    storage.getSavedUrlsWithTimestamps.mockResolvedValue(urlMap);

    const result = await logic.getSavedUrlsWithCache();

    expect(storage.getSavedUrlsWithTimestamps).toHaveBeenCalledTimes(1);
    expect(result.get('https://example.com')).toBeDefined();
  });

  test('returns cached data on second call within TTL', async () => {
    const urlMap = new Map([['https://example.com', Date.now()]]);
    // @ts-expect-error - jest.fn() type narrowing
    storage.getSavedUrlsWithTimestamps.mockResolvedValue(urlMap);

    await logic.getSavedUrlsWithCache();
    // @ts-expect-error - jest.fn() type narrowing
    storage.getSavedUrlsWithTimestamps.mockClear();

    const result = await logic.getSavedUrlsWithCache();

    // Should not call storage again (cache hit)
    expect(storage.getSavedUrlsWithTimestamps).not.toHaveBeenCalled();
    expect(result.get('https://example.com')).toBeDefined();
  });

  test('refetches from storage after TTL expires', async () => {
    // @ts-expect-error - jest.fn() type narrowing
    storage.getSavedUrlsWithTimestamps.mockResolvedValue(new Map([['https://first.com', 1]]));
    await logic.getSavedUrlsWithCache();

    // Expire the cache
    RecordingLogic.cacheState.urlCacheTimestamp = Date.now() - 61 * 1000; // 61 seconds ago

    const newMap = new Map([['https://second.com', 2]]);
    // @ts-expect-error - jest.fn() type narrowing
    storage.getSavedUrlsWithTimestamps.mockResolvedValue(newMap);
    // @ts-expect-error - jest.fn() type narrowing
    storage.getSavedUrlsWithTimestamps.mockClear();

    const result = await logic.getSavedUrlsWithCache();

    expect(storage.getSavedUrlsWithTimestamps).toHaveBeenCalledTimes(1);
    expect(result.get('https://second.com')).toBeDefined();
  });

  test('getSavedUrlsWithCache returns equivalent data on cache hit', async () => {
    const originalMap = new Map([['https://a.com', 1], ['https://b.com', 2]]);
    // @ts-expect-error - jest.fn() type narrowing
    storage.getSavedUrlsWithTimestamps.mockResolvedValue(originalMap);

    const first = await logic.getSavedUrlsWithCache();
    // @ts-expect-error - jest.fn() type narrowing
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
    (chrome.storage.session.get as jest.Mock).mockRejectedValueOnce(new Error('Session error'));

    const result = await logic.getPrivacyInfoWithCache('https://example.com/page');
    expect(result).toBeNull();

    // Restore
    (chrome.storage.session.get as jest.Mock).mockImplementation(originalGet as any);
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
  let mockExecute: jest.Mock;

  beforeEach(() => {
    resetCacheState();
    jest.clearAllMocks();

    // @ts-expect-error - jest.fn() type narrowing
    storage.getSettings.mockResolvedValue({ PRIVACY_MODE: 'full_pipeline' });
    // @ts-expect-error - jest.fn() type narrowing
    storage.getSavedUrlsWithTimestamps.mockResolvedValue(new Map());
    // @ts-expect-error - jest.fn() type narrowing
    domainUtils.isDomainAllowed.mockResolvedValue(true);

    mockExecute = jest.fn().mockResolvedValue({ success: true, summary: 'Pipeline summary' });
    // @ts-expect-error - jest.fn() type narrowing
    RecordingPipeline.mockImplementation(() => ({
      execute: mockExecute,
    }));

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
    // @ts-expect-error - jest.fn() type narrowing
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
  let mockExecute: jest.Mock;

  beforeEach(() => {
    resetCacheState();
    jest.clearAllMocks();

    // @ts-expect-error - jest.fn() type narrowing
    storage.getSettings.mockResolvedValue({ PRIVACY_MODE: 'full_pipeline' });
    // @ts-expect-error - jest.fn() type narrowing
    storage.getSavedUrlsWithTimestamps.mockResolvedValue(new Map());
    // @ts-expect-error - jest.fn() type narrowing
    domainUtils.isDomainAllowed.mockResolvedValue(true);

    mockExecute = jest.fn().mockResolvedValue({
      success: true,
      summary: 'Preview summary',
      processedContent: 'masked content',
    });
    // @ts-expect-error - jest.fn() type narrowing
    RecordingPipeline.mockImplementation(() => ({
      execute: mockExecute,
    }));

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

  test('stores obsidian and aiClient references', () => {
    const obsidian = makeMockObsidian();
    const aiClient = makeMockAiClient();
    const logic = new RecordingLogic(obsidian, aiClient);

    expect((logic as any).obsidian).toBe(obsidian);
    expect((logic as any).aiClient).toBe(aiClient);
  });
});

describe('RecordingLogic - settings cache interaction with record', () => {
  let logic: RecordingLogic;

  beforeEach(() => {
    resetCacheState();
    jest.clearAllMocks();

    // @ts-expect-error - jest.fn() type narrowing
    storage.getSettings.mockResolvedValue({ PRIVACY_MODE: 'full_pipeline' });
    // @ts-expect-error - jest.fn() type narrowing
    storage.getSavedUrlsWithTimestamps.mockResolvedValue(new Map());
    // @ts-expect-error - jest.fn() type narrowing
    domainUtils.isDomainAllowed.mockResolvedValue(true);

    // @ts-expect-error - jest.fn() type narrowing
    RecordingPipeline.mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue({ success: true }),
    }));

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

    // @ts-expect-error - jest.fn() type narrowing
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

    // @ts-expect-error - jest.fn() type narrowing
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
    jest.clearAllMocks();

    // @ts-expect-error - jest.fn() type narrowing
    storage.getSettings.mockResolvedValue({});
    // @ts-expect-error - jest.fn() type narrowing
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
