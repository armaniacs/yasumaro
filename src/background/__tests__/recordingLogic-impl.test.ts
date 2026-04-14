// src/background/__tests__/recordingLogic-impl.test.ts
// Tests for recordingLogic.ts internal methods and _recordImpl path
// Covers: isValidFetchUrl, private helpers, _recordImpl branches, _saveMetadata branches

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

const mockPermissionManager = {
  isHostPermitted: jest.fn().mockResolvedValue(true),
  recordDeniedVisit: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../../utils/permissionManager.js', () => ({
  getPermissionManager: jest.fn(() => mockPermissionManager),
}));

const mockTrustCheckResult = {
  canProceed: true,
  trustResult: { level: 'safe' },
};
jest.mock('../../utils/trustChecker.js', () => ({
  TrustChecker: jest.fn().mockImplementation(() => ({
    checkDomain: jest.fn().mockResolvedValue(mockTrustCheckResult),
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
  setUrlAiProvider: jest.fn().mockResolvedValue(undefined),
  setUrlAiModel: jest.fn().mockResolvedValue(undefined),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────────────
import { RecordingLogic, isValidFetchUrl, truncateContentSize } from '../recordingLogic.js';
import * as storage from '../../utils/storage.js';
import * as domainUtils from '../../utils/domainUtils.js';
import * as storageUrls from '../../utils/storageUrls.js';
import { NotificationHelper } from '../notificationHelper.js';
import { addPendingPage } from '../../utils/pendingStorage.js';
import { getPermissionManager } from '../../utils/permissionManager.js';
import { isPrivateIpAddress } from '../../utils/fetch.js';

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
    (isPrivateIpAddress as jest.Mock).mockReturnValueOnce(true);
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

// NOTE: Tests for the following private methods are skipped because the methods were removed
// as part of the refactoring (2026-04-14). The functionality is now in RecordingPipeline.
// These tests can be removed once the RecordingPipeline has equivalent test coverage.
describe.skip('RecordingLogic - _truncateContentIfNeeded', () => {
  let logic: RecordingLogic;

  beforeEach(() => {
    resetCacheState();
    logic = makeLogic();
  });

  test('returns content as-is when under limit', () => {
    const content = 'short content';
    expect((logic as any)._truncateContentIfNeeded(content)).toBe(content);
  });

  test('truncates content exceeding MAX_RECORD_SIZE', () => {
    const content = 'a'.repeat(100 * 1024); // 100KB
    const result = (logic as any)._truncateContentIfNeeded(content);
    expect(result.length).toBeLessThan(content.length);
    expect(new TextEncoder().encode(result).length).toBeLessThanOrEqual(64 * 1024);
  });

  test('returns empty string unchanged', () => {
    expect((logic as any)._truncateContentIfNeeded('')).toBe('');
  });

  test('returns falsy content unchanged', () => {
    expect((logic as any)._truncateContentIfNeeded(null)).toBeNull();
    expect((logic as any)._truncateContentIfNeeded(undefined)).toBeUndefined();
  });
});

// Tests skipped - method removed in refactoring (2026-04-14)
describe.skip('RecordingLogic - _checkDomainFilter', () => {
  let logic: RecordingLogic;

  beforeEach(() => {
    resetCacheState();
    logic = makeLogic();
    jest.clearAllMocks();
  });

  test('returns true when domain is allowed', async () => {
    (domainUtils.isDomainAllowed as jest.Mock).mockResolvedValue(true);
    const result = await (logic as any)._checkDomainFilter('https://example.com');
    expect(result).toBe(true);
  });

  test('returns false when domain is blocked', async () => {
    (domainUtils.isDomainAllowed as jest.Mock).mockResolvedValue(false);
    const result = await (logic as any)._checkDomainFilter('https://blocked.com');
    expect(result).toBe(false);
  });
});

// Tests skipped - method removed in refactoring (2026-04-14)
describe.skip('RecordingLogic - _checkPermission', () => {
  let logic: RecordingLogic;

  beforeEach(() => {
    resetCacheState();
    logic = makeLogic();
    jest.clearAllMocks();
  });

  test('returns true when host is permitted', async () => {
    mockPermissionManager.isHostPermitted.mockResolvedValue(true);
    const result = await (logic as any)._checkPermission('https://example.com');
    expect(result).toBe(true);
  });

  test('returns false and records denied visit when not permitted', async () => {
    mockPermissionManager.isHostPermitted.mockResolvedValue(false);
    mockPermissionManager.recordDeniedVisit.mockResolvedValue(undefined);

    const result = await (logic as any)._checkPermission('https://example.com/page');
    expect(result).toBe(false);
    expect(mockPermissionManager.recordDeniedVisit).toHaveBeenCalled();
  });

  test('handles domain extraction failure gracefully', async () => {
    mockPermissionManager.isHostPermitted.mockResolvedValue(false);

    // Pass an invalid URL that will fail both extractDomain and new URL()
    const result = await (logic as any)._checkPermission('not-a-valid-url');
    expect(result).toBe(false);
  });
});

// Tests skipped - method removed in refactoring (2026-04-14)
describe.skip('RecordingLogic - _checkTrustDomain', () => {
  let logic: RecordingLogic;

  beforeEach(() => {
    resetCacheState();
    logic = makeLogic();
    jest.clearAllMocks();
  });

  test('returns trust check result', async () => {
    const result = await (logic as any)._checkTrustDomain('https://example.com', false);
    expect(result).toHaveProperty('canProceed');
  });
});

// Tests skipped - method removed in refactoring (2026-04-14)
describe.skip('RecordingLogic - _formatMarkdown', () => {
  let logic: RecordingLogic;

  beforeEach(() => {
    resetCacheState();
    logic = makeLogic();
  });

  test('formats markdown with title, url, and summary', () => {
    const result = (logic as any)._formatMarkdown(
      'Test Title',
      'https://example.com',
      'Test summary'
    );
    expect(result).toContain('Test Title');
    expect(result).toContain('https://example.com');
    expect(result).toContain('Test summary');
    expect(result).not.toContain('AI要約:');
  });

  test('includes timestamp', () => {
    const result = (logic as any)._formatMarkdown(
      'Title',
      'https://example.com',
      'Summary'
    );
    // Timestamp format: HH:MM
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  test('LLMが返す \\n\\n をスペースに変換する（Obsidianで改行しない）', () => {
    const result = (logic as any)._formatMarkdown(
      'Title',
      'https://example.com',
      '#タグ1 | 一行目\n\n詳細説明\n\n#タグ2 | 二行目'
    );
    // 箇条書き行（"    - " 以降）に改行が含まれないこと
    const bulletLine = result.split('    - ')[1];
    expect(bulletLine).not.toContain('\n');
  });

  test('単独の \\n もスペースに変換する', () => {
    const result = (logic as any)._formatMarkdown(
      'Title',
      'https://example.com',
      '一行目\n二行目'
    );
    expect(result).toContain('一行目 二行目');
    expect(result.split('    - ')[1]).not.toContain('\n');
  });

  test('連続スペースは1つにまとめる', () => {
    const result = (logic as any)._formatMarkdown(
      'Title',
      'https://example.com',
      '一行目\n\n二行目'
    );
    expect(result).toContain('一行目 二行目');
    expect(result.split('    - ')[1]).not.toContain('  ');
  });

  test('tags を渡すと "#タグ1 #タグ2 要約文" 形式で箇条書き行に出力される', () => {
    const result = (logic as any)._formatMarkdown(
      'Title',
      'https://example.com',
      '要約文',
      ['IT・プログラミング', 'インフラ・ネットワーク']
    );
    const bulletLine = result.split('    - ')[1];
    expect(bulletLine).toBe('#IT・プログラミング #インフラ・ネットワーク 要約文');
  });

  test('tags が空配列の場合はタグを追加しない', () => {
    const result = (logic as any)._formatMarkdown(
      'Title',
      'https://example.com',
      '要約文',
      []
    );
    expect(result).not.toMatch(/#\S+/);
  });

  test('tags が undefined の場合はタグを追加しない', () => {
    const result = (logic as any)._formatMarkdown(
      'Title',
      'https://example.com',
      '要約文',
      undefined
    );
    expect(result).not.toMatch(/#\S+/);
  });
});

// Tests skipped - method removed in refactoring (2026-04-14)
describe.skip('RecordingLogic - _saveToObsidian', () => {
  let logic: RecordingLogic;
  let mockObsidian: any;

  beforeEach(() => {
    resetCacheState();
    mockObsidian = makeMockObsidian();
    logic = new RecordingLogic(mockObsidian, makeMockAiClient());
  });

  test('calls appendToDailyNote with markdown', async () => {
    await (logic as any)._saveToObsidian('- test markdown', 'Title', 'https://example.com');
    expect(mockObsidian.appendToDailyNote).toHaveBeenCalledWith('- test markdown');
  });
});

// Tests skipped - method removed in refactoring (2026-04-14)
describe.skip('RecordingLogic - _saveMetadata', () => {
  let logic: RecordingLogic;

  beforeEach(() => {
    resetCacheState();
    logic = makeLogic();
    jest.clearAllMocks();
  });

  const baseData = {
    title: 'Test',
    url: 'https://example.com',
    content: 'test content',
  };

  const basePipelineResult = {
    summary: 'Summary',
    maskedCount: 0,
  };

  test('sets recordType from data', async () => {
    await (logic as any)._saveMetadata(
      { ...baseData, recordType: 'manual' },
      basePipelineResult
    );
    expect(storageUrls.setUrlRecordType).toHaveBeenCalledWith('https://example.com', 'manual');
  });

  test('defaults recordType to auto', async () => {
    await (logic as any)._saveMetadata(baseData, basePipelineResult);
    expect(storageUrls.setUrlRecordType).toHaveBeenCalledWith('https://example.com', 'auto');
  });

  test('uses precomputedMaskedCount when provided', async () => {
    await (logic as any)._saveMetadata(
      { ...baseData, precomputedMaskedCount: 5 },
      { ...basePipelineResult, maskedCount: 3 }
    );
    expect(storageUrls.setUrlMaskedCount).toHaveBeenCalledWith('https://example.com', 5);
  });

  test('uses pipelineResult.maskedCount when precomputed not provided', async () => {
    await (logic as any)._saveMetadata(
      baseData,
      { ...basePipelineResult, maskedCount: 3 }
    );
    expect(storageUrls.setUrlMaskedCount).toHaveBeenCalledWith('https://example.com', 3);
  });

  test('skips maskedCount when 0', async () => {
    await (logic as any)._saveMetadata(baseData, basePipelineResult);
    expect(storageUrls.setUrlMaskedCount).not.toHaveBeenCalled();
  });

  test('saves content when provided', async () => {
    await (logic as any)._saveMetadata(
      { ...baseData, content: 'page content' },
      basePipelineResult
    );
    expect(storageUrls.setUrlContent).toHaveBeenCalledWith('https://example.com', 'page content');
  });

  test('skips content when empty', async () => {
    await (logic as any)._saveMetadata(
      { ...baseData, content: '' },
      basePipelineResult
    );
    expect(storageUrls.setUrlContent).not.toHaveBeenCalled();
  });

  test('saves tags when present', async () => {
    await (logic as any)._saveMetadata(
      baseData,
      { ...basePipelineResult, tags: ['tech', 'ai'] }
    );
    expect(storageUrls.setUrlTags).toHaveBeenCalledWith('https://example.com', ['tech', 'ai']);
  });

  test('skips tags when empty', async () => {
    await (logic as any)._saveMetadata(baseData, basePipelineResult);
    expect(storageUrls.setUrlTags).not.toHaveBeenCalled();
  });

  test('saves AI summary when present', async () => {
    await (logic as any)._saveMetadata(
      baseData,
      { ...basePipelineResult, summary: 'AI summary text' }
    );
    expect(storageUrls.setUrlAiSummary).toHaveBeenCalledWith('https://example.com', 'AI summary text');
  });

  test('saves sentTokens when defined', async () => {
    await (logic as any)._saveMetadata(
      baseData,
      { ...basePipelineResult, sentTokens: 100 }
    );
    expect(storageUrls.setUrlSentTokens).toHaveBeenCalledWith('https://example.com', 100);
  });

  test('saves receivedTokens when defined', async () => {
    await (logic as any)._saveMetadata(
      baseData,
      { ...basePipelineResult, receivedTokens: 200 }
    );
    expect(storageUrls.setUrlReceivedTokens).toHaveBeenCalledWith('https://example.com', 200);
  });

  test('saves originalTokens when defined', async () => {
    await (logic as any)._saveMetadata(
      baseData,
      { ...basePipelineResult, originalTokens: 150 }
    );
    expect(storageUrls.setUrlOriginalTokens).toHaveBeenCalledWith('https://example.com', 150);
  });

  test('saves cleansedTokens when defined', async () => {
    await (logic as any)._saveMetadata(
      baseData,
      { ...basePipelineResult, cleansedTokens: 80 }
    );
    expect(storageUrls.setUrlCleansedTokens).toHaveBeenCalledWith('https://example.com', 80);
  });

  test('saves pageBytes when defined', async () => {
    await (logic as any)._saveMetadata(
      { ...baseData, pageBytes: 4096 },
      basePipelineResult
    );
    expect(storageUrls.setUrlPageBytes).toHaveBeenCalledWith('https://example.com', 4096);
  });

  test('saves candidateBytes when defined', async () => {
    await (logic as any)._saveMetadata(
      { ...baseData, candidateBytes: 2048 },
      basePipelineResult
    );
    expect(storageUrls.setUrlCandidateBytes).toHaveBeenCalledWith('https://example.com', 2048);
  });

  test('saves originalBytes when defined', async () => {
    await (logic as any)._saveMetadata(
      { ...baseData, originalBytes: 3000 },
      basePipelineResult
    );
    expect(storageUrls.setUrlOriginalBytes).toHaveBeenCalledWith('https://example.com', 3000);
  });

  test('saves cleansedBytes when defined', async () => {
    await (logic as any)._saveMetadata(
      { ...baseData, cleansedBytes: 1500 },
      basePipelineResult
    );
    expect(storageUrls.setUrlCleansedBytes).toHaveBeenCalledWith('https://example.com', 1500);
  });

  test('saves aiSummaryOriginalBytes when defined', async () => {
    await (logic as any)._saveMetadata(
      { ...baseData, aiSummaryOriginalBytes: 5000 },
      basePipelineResult
    );
    expect(storageUrls.setUrlAiSummaryOriginalBytes).toHaveBeenCalledWith('https://example.com', 5000);
  });

  test('saves aiSummaryCleansedBytes when defined', async () => {
    await (logic as any)._saveMetadata(
      { ...baseData, aiSummaryCleansedBytes: 3000 },
      basePipelineResult
    );
    expect(storageUrls.setUrlAiSummaryCleansedBytes).toHaveBeenCalledWith('https://example.com', 3000);
  });

  test('saves aiSummaryCleansedElements when defined', async () => {
    await (logic as any)._saveMetadata(
      { ...baseData, aiSummaryCleansedElements: 5 },
      basePipelineResult
    );
    expect(storageUrls.setUrlAiSummaryCleansedElements).toHaveBeenCalledWith('https://example.com', 5);
  });

  test('saves aiSummaryCleansedReason when defined', async () => {
    await (logic as any)._saveMetadata(
      { ...baseData, aiSummaryCleansedReason: 'ads' },
      basePipelineResult
    );
    expect(storageUrls.setUrlAiSummaryCleansedReason).toHaveBeenCalledWith('https://example.com', 'ads');
  });

  test('invalidates URL cache after saving', async () => {
    const invalidateSpy = jest.spyOn(RecordingLogic, 'invalidateUrlCache');
    await (logic as any)._saveMetadata(baseData, basePipelineResult);
    expect(invalidateSpy).toHaveBeenCalled();
  });
});

describe.skip('RecordingLogic - _recordImpl', () => {
  let logic: RecordingLogic;
  let mockObsidian: any;
  let mockPipelineProcess: jest.Mock;

  beforeEach(() => {
    resetCacheState();
    jest.clearAllMocks();

    // Reset shared mocks
    mockPermissionManager.isHostPermitted.mockResolvedValue(true);
    mockPermissionManager.recordDeniedVisit.mockResolvedValue(undefined);

    // Reset TrustChecker mock to default (canProceed: true)
    const { TrustChecker } = require('../../utils/trustChecker.js');
    (TrustChecker as jest.Mock).mockImplementation(() => ({
      checkDomain: jest.fn().mockResolvedValue({
        canProceed: true,
        trustResult: { level: 'safe' },
      }),
    }));

    mockObsidian = makeMockObsidian();
    logic = new RecordingLogic(mockObsidian, makeMockAiClient());

    // Default mocks
    (storage.getSettings as jest.Mock).mockResolvedValue({
      PRIVACY_MODE: 'full_pipeline',
      DOMAIN_WHITELIST: [],
      AUTO_SAVE_PRIVACY_BEHAVIOR: 'save',
    });
    (storage.getSavedUrlsWithTimestamps as jest.Mock).mockResolvedValue(new Map());
    (storage.setSavedUrlsWithTimestamps as jest.Mock).mockResolvedValue(undefined);
    (domainUtils.isDomainAllowed as jest.Mock).mockResolvedValue(true);
    (domainUtils.extractDomain as jest.Mock).mockImplementation((url: string) => {
      try { return new URL(url).hostname; } catch { return null; }
    });
    (domainUtils.isDomainInList as jest.Mock).mockReturnValue(false);

    // Default PrivacyPipeline mock
    mockPipelineProcess = jest.fn().mockResolvedValue({ summary: 'Summary', maskedCount: 0, success: true });
    const { PrivacyPipeline } = require('../privacyPipeline.js');
    (PrivacyPipeline as jest.Mock).mockImplementation(() => ({
      process: mockPipelineProcess,
    }));
  });

  test('returns DOMAIN_BLOCKED when domain not allowed and not forced', async () => {
    (domainUtils.isDomainAllowed as jest.Mock).mockResolvedValue(false);

    const result = await (logic as any)._recordImpl({
      title: 'Test',
      url: 'https://blocked.com',
      content: 'content',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('DOMAIN_BLOCKED');
  });

  test('continues with force when domain blocked', async () => {
    (domainUtils.isDomainAllowed as jest.Mock).mockResolvedValue(false);

    const result = await (logic as any)._recordImpl({
      title: 'Test',
      url: 'https://blocked.com',
      content: 'content',
      force: true,
    });

    expect(result.success).toBe(true);
  });

  test('returns PERMISSION_REQUIRED when permission denied', async () => {
    mockPermissionManager.isHostPermitted.mockResolvedValue(false);

    const result = await (logic as any)._recordImpl({
      title: 'Test',
      url: 'https://example.com',
      content: 'content',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('PERMISSION_REQUIRED');
  });

  test('returns DOMAIN_NOT_TRUSTED when trust check fails', async () => {
    const { TrustChecker } = require('../../utils/trustChecker.js');
    (TrustChecker as jest.Mock).mockImplementation(() => ({
      checkDomain: jest.fn().mockResolvedValue({
        canProceed: false,
        reason: 'Suspicious domain',
        showAlert: true,
        trustResult: { level: 'unverified' },
      }),
    }));

    const result = await (logic as any)._recordImpl({
      title: 'Test',
      url: 'https://suspicious.com',
      content: 'content',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('DOMAIN_NOT_TRUSTED');
    expect(NotificationHelper.notifyError).toHaveBeenCalled();
  });

  test('trust check fails without showAlert does not notify', async () => {
    const { TrustChecker } = require('../../utils/trustChecker.js');
    (TrustChecker as jest.Mock).mockImplementation(() => ({
      checkDomain: jest.fn().mockResolvedValue({
        canProceed: false,
        reason: 'Suspicious',
        showAlert: false,
        trustResult: { level: 'unverified' },
      }),
    }));

    const result = await (logic as any)._recordImpl({
      title: 'Test',
      url: 'https://suspicious.com',
      content: 'content',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('DOMAIN_NOT_TRUSTED');
    expect(NotificationHelper.notifyError).not.toHaveBeenCalled();
  });

  test('skips trust check when force=true', async () => {
    const { TrustChecker } = require('../../utils/trustChecker.js');
    (TrustChecker as jest.Mock).mockImplementation(() => ({
      checkDomain: jest.fn().mockResolvedValue({
        canProceed: false,
        reason: 'Suspicious',
        showAlert: false,
        trustResult: { level: 'unverified' },
      }),
    }));

    const result = await (logic as any)._recordImpl({
      title: 'Test',
      url: 'https://suspicious.com',
      content: 'content',
      force: true,
    });

    expect(result.success).toBe(true);
  });

  test('returns PRIVATE_PAGE_DETECTED when privacy header found with skip behavior', async () => {
    (storage.getSettings as jest.Mock).mockResolvedValue({
      PRIVACY_MODE: 'full_pipeline',
      DOMAIN_WHITELIST: [],
      AUTO_SAVE_PRIVACY_BEHAVIOR: 'skip',
    });

    // Directly mock the private method
    (logic as any)._checkPrivacyHeaders = jest.fn().mockResolvedValue({
      canProceed: false,
      result: { success: false, error: 'PRIVATE_PAGE_DETECTED', reason: 'cache-control' },
    });

    const result = await (logic as any)._recordImpl({
      title: 'Private Page',
      url: 'https://private.com/page',
      content: 'content',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('PRIVATE_PAGE_DETECTED');
  });

  test('returns PRIVATE_PAGE_DETECTED with confirmationRequired for confirm behavior', async () => {
    (storage.getSettings as jest.Mock).mockResolvedValue({
      PRIVACY_MODE: 'full_pipeline',
      DOMAIN_WHITELIST: [],
      AUTO_SAVE_PRIVACY_BEHAVIOR: 'confirm',
    });

    (logic as any)._checkPrivacyHeaders = jest.fn().mockResolvedValue({
      canProceed: false,
      result: { success: false, error: 'PRIVATE_PAGE_DETECTED', reason: 'set-cookie', confirmationRequired: true },
    });

    const result = await (logic as any)._recordImpl({
      title: 'Private Page',
      url: 'https://private.com/page',
      content: 'content',
    });

    expect(result.success).toBe(false);
    expect(result.confirmationRequired).toBe(true);
  });

  test('auto-save behavior save continues recording for private page', async () => {
    (storage.getSettings as jest.Mock).mockResolvedValue({
      PRIVACY_MODE: 'full_pipeline',
      DOMAIN_WHITELIST: [],
      AUTO_SAVE_PRIVACY_BEHAVIOR: 'save',
    });

    const url = 'https://private.com/page';
    RecordingLogic.cacheState.privacyCache = new Map([
      [url, { isPrivate: true, reason: 'cache-control', timestamp: Date.now() }],
    ]);

    const result = await (logic as any)._recordImpl({
      title: 'Private Page',
      url,
      content: 'content',
    });

    expect(result.success).toBe(true);
  });

  test('bypasses privacy check for whitelisted domain', async () => {
    (storage.getSettings as jest.Mock).mockResolvedValue({
      PRIVACY_MODE: 'full_pipeline',
      DOMAIN_WHITELIST: ['trusted.com'],
      AUTO_SAVE_PRIVACY_BEHAVIOR: 'skip',
    });
    (domainUtils.isDomainInList as jest.Mock).mockReturnValue(true);

    const url = 'https://trusted.com/page';
    RecordingLogic.cacheState.privacyCache = new Map([
      [url, { isPrivate: true, reason: 'cache-control', timestamp: Date.now() }],
    ]);

    const result = await (logic as any)._recordImpl({
      title: 'Trusted Page',
      url,
      content: 'content',
    });

    expect(result.success).toBe(true);
  });

  test('falls back to privacy check when whitelist check throws', async () => {
    (storage.getSettings as jest.Mock)
      .mockResolvedValueOnce({
        PRIVACY_MODE: 'full_pipeline',
        DOMAIN_WHITELIST: ['example.com'],
        AUTO_SAVE_PRIVACY_BEHAVIOR: 'skip',
      })
      .mockResolvedValueOnce({
        PRIVACY_MODE: 'full_pipeline',
        DOMAIN_WHITELIST: [],
        AUTO_SAVE_PRIVACY_BEHAVIOR: 'skip',
      });
    (domainUtils.extractDomain as jest.Mock).mockImplementation(() => {
      throw new Error('Parse error');
    });

    (logic as any)._checkPrivacyHeaders = jest.fn().mockResolvedValue({
      canProceed: false,
      result: { success: false, error: 'PRIVATE_PAGE_DETECTED', reason: 'cache-control' },
    });

    const result = await (logic as any)._recordImpl({
      title: 'Test',
      url: 'https://broken.com/page',
      content: 'content',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('PRIVATE_PAGE_DETECTED');
  });

  test('returns same_day duplicate when URL already saved today', async () => {
    const url = 'https://example.com/page';
    (storage.getSavedUrlsWithTimestamps as jest.Mock).mockResolvedValue(
      new Map([[url, Date.now()]])
    );

    const result = await (logic as any)._recordImpl({
      title: 'Test',
      url,
      content: 'content',
    });

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
  });

  test('proceeds when URL was saved on a different day', async () => {
    const url = 'https://example.com/page';
    const yesterday = Date.now() - 25 * 60 * 60 * 1000;
    (storage.getSavedUrlsWithTimestamps as jest.Mock).mockResolvedValue(
      new Map([[url, yesterday]])
    );

    const result = await (logic as any)._recordImpl({
      title: 'Test',
      url,
      content: 'content',
    });

    expect(result.success).toBe(true);
  });

  test('skips duplicate check when skipDuplicateCheck=true', async () => {
    const url = 'https://example.com/page';
    (storage.getSavedUrlsWithTimestamps as jest.Mock).mockResolvedValue(
      new Map([[url, Date.now()]])
    );

    const result = await (logic as any)._recordImpl({
      title: 'Test',
      url,
      content: 'content',
      skipDuplicateCheck: true,
    });

    expect(result.success).toBe(true);
    expect(result.skipped).toBeUndefined();
  });

  test('returns error when URL set size limit exceeded', async () => {
    const bigMap = new Map<string, number>();
    for (let i = 0; i < 10001; i++) {
      bigMap.set(`https://example${i}.com`, Date.now());
    }
    (storage.getSavedUrlsWithTimestamps as jest.Mock).mockResolvedValue(bigMap);

    const result = await (logic as any)._recordImpl({
      title: 'Test',
      url: 'https://newsite.com',
      content: 'content',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('URL set size limit exceeded');
  });

  test('handles previewOnly mode', async () => {
    mockPipelineProcess.mockResolvedValue({
      success: true,
      summary: 'Preview summary',
      maskedCount: 2,
    });

    const result = await (logic as any)._recordImpl({
      title: 'Test',
      url: 'https://example.com',
      content: 'content',
      previewOnly: true,
    });

    expect(result.success).toBe(true);
    expect(result.title).toBe('Test');
    expect(result.url).toBe('https://example.com');
  });

  test('handles previewOnly with pipeline error', async () => {
    mockPipelineProcess.mockRejectedValue(new Error('Pipeline error'));

    const result = await (logic as any)._recordImpl({
      title: 'Test',
      url: 'https://example.com',
      content: 'content',
      previewOnly: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Pipeline error');
  });

  test('re-throws pipeline error in non-preview mode', async () => {
    mockPipelineProcess.mockRejectedValue(new Error('Pipeline error'));

    // _recordImpl catches pipeline errors and re-throws in non-preview mode
    // but the outer try/catch in _recordImpl catches it and returns error result
    const result = await (logic as any)._recordImpl({
      title: 'Test',
      url: 'https://example.com',
      content: 'content',
      previewOnly: false,
    });

    // The outer catch block returns { success: false, error: e.message }
    expect(result.success).toBe(false);
    expect(result.error).toBe('Pipeline error');
  });

  test('full successful recording flow', async () => {
    mockPipelineProcess.mockResolvedValue({
      summary: 'Full summary',
      maskedCount: 3,
      tags: ['tech'],
      sentTokens: 100,
      receivedTokens: 200,
    });

    const result = await (logic as any)._recordImpl({
      title: 'Full Test',
      url: 'https://example.com/article',
      content: 'Full content',
      recordType: 'manual',
      pageBytes: 8192,
      candidateBytes: 4096,
      originalBytes: 3000,
      cleansedBytes: 2000,
    });

    expect(result.success).toBe(true);
    expect(mockObsidian.appendToDailyNote).toHaveBeenCalled();
    expect(NotificationHelper.notifySuccess).toHaveBeenCalled();
    expect(storageUrls.setUrlRecordType).toHaveBeenCalledWith('https://example.com/article', 'manual');
    expect(storageUrls.setUrlTags).toHaveBeenCalled();
    expect(storageUrls.setUrlAiSummary).toHaveBeenCalled();
    expect(storageUrls.setUrlSentTokens).toHaveBeenCalled();
    expect(storageUrls.setUrlReceivedTokens).toHaveBeenCalled();
    expect(storageUrls.setUrlPageBytes).toHaveBeenCalled();
    expect(storageUrls.setUrlCandidateBytes).toHaveBeenCalled();
    expect(storageUrls.setUrlOriginalBytes).toHaveBeenCalled();
    expect(storageUrls.setUrlCleansedBytes).toHaveBeenCalled();
  });

  test('handles alreadyProcessed mode', async () => {
    const result = await (logic as any)._recordImpl({
      title: 'Test',
      url: 'https://example.com',
      content: 'content',
      alreadyProcessed: true,
      precomputedMaskedCount: 7,
    });

    expect(result.success).toBe(true);
  });

  test('catches top-level errors and returns error result', async () => {
    // Force an error by making appendToDailyNote reject
    mockObsidian.appendToDailyNote.mockRejectedValue(new Error('Obsidian error'));

    const result = await (logic as any)._recordImpl({
      title: 'Test',
      url: 'https://example.com',
      content: 'content',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Obsidian error');
  });

  test('handles requireConfirmation=true with private page', async () => {
    const url = 'https://private.com/page';
    RecordingLogic.cacheState.privacyCache = new Map([
      [url, { isPrivate: true, reason: 'cache-control', timestamp: Date.now() }],
    ]);

    const result = await (logic as any)._recordImpl({
      title: 'Private Page',
      url,
      content: 'content',
      requireConfirmation: true,
      headerValue: 'private',
    });

    expect(result.success).toBe(false);
    expect(result.confirmationRequired).toBe(true);
    expect(addPendingPage).toHaveBeenCalled();
  });

  test('force recording private page logs warning', async () => {
    const url = 'https://private.com/page';
    RecordingLogic.cacheState.privacyCache = new Map([
      [url, { isPrivate: true, reason: 'authorization', timestamp: Date.now() }],
    ]);

    const result = await (logic as any)._recordImpl({
      title: 'Force Private',
      url,
      content: 'content',
      force: true,
    });

    expect(result.success).toBe(true);
  });

  test('handles all metadata fields in _saveMetadata', async () => {
    mockPipelineProcess.mockResolvedValue({
      summary: 'Summary',
      maskedCount: 5,
      tags: ['tag1'],
      sentTokens: 100,
      receivedTokens: 200,
      originalTokens: 150,
      cleansedTokens: 80,
    });

    const result = await (logic as any)._recordImpl({
      title: 'Meta Test',
      url: 'https://example.com/meta',
      content: 'content',
      recordType: 'auto',
      pageBytes: 1000,
      candidateBytes: 800,
      originalBytes: 600,
      cleansedBytes: 400,
      aiSummaryOriginalBytes: 500,
      aiSummaryCleansedBytes: 300,
      aiSummaryCleansedElements: 3,
      aiSummaryCleansedReason: 'ads',
    });

    expect(result.success).toBe(true);
    expect(storageUrls.setUrlOriginalTokens).toHaveBeenCalled();
    expect(storageUrls.setUrlCleansedTokens).toHaveBeenCalled();
    expect(storageUrls.setUrlAiSummaryOriginalBytes).toHaveBeenCalled();
    expect(storageUrls.setUrlAiSummaryCleansedBytes).toHaveBeenCalled();
    expect(storageUrls.setUrlAiSummaryCleansedElements).toHaveBeenCalled();
    expect(storageUrls.setUrlAiSummaryCleansedReason).toHaveBeenCalled();
  });

  test('handles pipeline result without summary', async () => {
    mockPipelineProcess.mockResolvedValue({
      maskedCount: 0,
    });

    const result = await (logic as any)._recordImpl({
      title: 'No Summary',
      url: 'https://example.com',
      content: 'content',
    });

    expect(result.success).toBe(true);
    // Falls back to 'Summary not available.'
  });

  test('handles pipeline result without urlMap from duplicate check', async () => {
    // Empty URL map so no duplicate, and the urlMap should be returned
    (storage.getSavedUrlsWithTimestamps as jest.Mock).mockResolvedValue(new Map());

    const result = await (logic as any)._recordImpl({
      title: 'Test',
      url: 'https://example.com',
      content: 'content',
    });

    expect(result.success).toBe(true);
  });

  test('auto-save behavior save continues without blocking private page', async () => {
    (storage.getSettings as jest.Mock).mockResolvedValue({
      PRIVACY_MODE: 'full_pipeline',
      DOMAIN_WHITELIST: [],
      AUTO_SAVE_PRIVACY_BEHAVIOR: 'save',
    });

    // Mock _checkPrivacyHeaders to return canProceed: true (save behavior)
    (logic as any)._checkPrivacyHeaders = jest.fn().mockResolvedValue({
      canProceed: true,
    });

    const result = await (logic as any)._recordImpl({
      title: 'Auto Save Page',
      url: 'https://example.com',
      content: 'content',
    });

    expect(result.success).toBe(true);
  });

  test('auto-save behavior confirm blocks with confirmationRequired', async () => {
    (storage.getSettings as jest.Mock).mockResolvedValue({
      PRIVACY_MODE: 'full_pipeline',
      DOMAIN_WHITELIST: [],
      AUTO_SAVE_PRIVACY_BEHAVIOR: 'confirm',
    });

    (logic as any)._checkPrivacyHeaders = jest.fn().mockResolvedValue({
      canProceed: false,
      result: { success: false, error: 'PRIVATE_PAGE_DETECTED', confirmationRequired: true },
    });

    const result = await (logic as any)._recordImpl({
      title: 'Confirm Page',
      url: 'https://example.com',
      content: 'content',
    });

    expect(result.success).toBe(false);
    expect(result.confirmationRequired).toBe(true);
  });

  test('whitelist check with matching domain bypasses privacy check', async () => {
    (storage.getSettings as jest.Mock).mockResolvedValue({
      PRIVACY_MODE: 'full_pipeline',
      DOMAIN_WHITELIST: ['example.com'],
      AUTO_SAVE_PRIVACY_BEHAVIOR: 'skip',
    });
    (domainUtils.isDomainInList as jest.Mock).mockReturnValue(true);
    (domainUtils.extractDomain as jest.Mock).mockReturnValue('example.com');

    const result = await (logic as any)._recordImpl({
      title: 'Whitelisted',
      url: 'https://example.com/page',
      content: 'content',
    });

    expect(result.success).toBe(true);
  });

  test('URL set approaching warning threshold logs warning', async () => {
    // Need to import URL_WARNING_THRESHOLD
    const { URL_WARNING_THRESHOLD } = require('../../utils/storage.js');
    const nearLimitMap = new Map<string, number>();
    for (let i = 0; i < URL_WARNING_THRESHOLD; i++) {
      nearLimitMap.set(`https://example${i}.com`, Date.now() - 1000);
    }
    (storage.getSavedUrlsWithTimestamps as jest.Mock).mockResolvedValue(nearLimitMap);

    const result = await (logic as any)._recordImpl({
      title: 'Test',
      url: 'https://newsite.com',
      content: 'content',
    });

    // Should still succeed but log a warning
    expect(result.success).toBe(true);
  });
});

// Tests skipped - method removed in refactoring (2026-04-14)
describe.skip('RecordingLogic - _savePendingPage', () => {
  let logic: RecordingLogic;

  beforeEach(() => {
    resetCacheState();
    logic = makeLogic();
    jest.clearAllMocks();
  });

  test('saves pending page with masked header value', async () => {
    await (logic as any)._savePendingPage(
      'https://example.com',
      'Title',
      'cache-control',
      'private, no-store'
    );

    expect(addPendingPage).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://example.com',
        title: 'Title',
        reason: 'cache-control',
        headerValue: 'private, no-store',
      })
    );
  });

  test('truncates header value exceeding 1024 characters', async () => {
    const longValue = 'x'.repeat(2000);
    await (logic as any)._savePendingPage(
      'https://example.com',
      'Title',
      'authorization',
      longValue
    );

    expect(addPendingPage).toHaveBeenCalledWith(
      expect.objectContaining({
        headerValue: expect.stringMatching(/^.{1024}$/),
      })
    );
  });
});

// Tests skipped - method removed in refactoring (2026-04-14)
describe.skip('_saveMetadata: AI provider and model', () => {
  let logic: RecordingLogic;

  beforeEach(() => {
    resetCacheState();
    logic = makeLogic();
    jest.clearAllMocks();
  });

  test('pipelineResultにaiProviderがある場合setUrlAiProviderを呼ぶ', async () => {
    const data = {
      title: 'Test', url: 'https://example.com', content: 'body',
      recordType: 'auto' as const,
    };
    const pipelineResult = { summary: 'ok', maskedCount: 0, aiProvider: 'lm-studio' };

    await (logic as any)._saveMetadata(data, pipelineResult);

    expect(storageUrls.setUrlAiProvider).toHaveBeenCalledWith('https://example.com', 'lm-studio');
  });

  test('pipelineResultにaiModelがある場合setUrlAiModelを呼ぶ', async () => {
    const data = {
      title: 'Test', url: 'https://example.com', content: 'body',
      recordType: 'auto' as const,
    };
    const pipelineResult = { summary: 'ok', maskedCount: 0, aiModel: 'gemma-4-e4b-it' };

    await (logic as any)._saveMetadata(data, pipelineResult);

    expect(storageUrls.setUrlAiModel).toHaveBeenCalledWith('https://example.com', 'gemma-4-e4b-it');
  });

  test('aiProviderもaiModelもない場合はsetUrlAiProvider/setUrlAiModelを呼ばない', async () => {
    const data = {
      title: 'Test', url: 'https://example.com', content: 'body',
      recordType: 'auto' as const,
    };
    const pipelineResult = { summary: 'ok', maskedCount: 0 };

    await (logic as any)._saveMetadata(data, pipelineResult);

    expect(storageUrls.setUrlAiProvider).not.toHaveBeenCalled();
    expect(storageUrls.setUrlAiModel).not.toHaveBeenCalled();
  });
});
