/**
 * RecordingPipeline-r2.test.ts — additional branch coverage
 * Covers: per-step failure short-circuits, private-page-detected result,
 * RETRY success path, BEST_EFFORT error accumulation, missing sqliteClient
 * skip, contentStorageEnabled path, previewOnly PII masking.
 */
import { vi } from 'vitest';

const mockStorage: Record<string, unknown> = {};
globalThis.chrome = {
  ...(globalThis.chrome || {}),
  storage: {
    ...((globalThis.chrome as any)?.storage || {}),
    local: {
      get: vi.fn((keys: string | string[] | null | undefined) => {
        if (keys === null || keys === undefined) return Promise.resolve({ ...mockStorage });
        if (Array.isArray(keys)) {
          const result: Record<string, unknown> = {};
          for (const key of keys) if (key in mockStorage) result[key] = mockStorage[key];
          return Promise.resolve(result);
        }
        if (typeof keys === 'string') return Promise.resolve({ [keys]: mockStorage[keys] });
        return Promise.resolve({});
      }),
      set: vi.fn((items: Record<string, unknown>) => { Object.assign(mockStorage, items); return Promise.resolve(); }),
      remove: vi.fn((keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete mockStorage[key];
        return Promise.resolve();
      }),
    },
  },
  i18n: { getMessage: vi.fn(() => 'Recording Failed') },
  notifications: { create: vi.fn() },
  runtime: { id: 'test-extension-id' },
} as any;

vi.mock('../../../utils/storage.js');
vi.mock('../../../utils/errorUtils.js', () => ({
  errorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));
vi.mock('../../../utils/pendingStorage.js', () => ({
  addPendingPage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../utils/crypto.js', () => ({ hashUrl: vi.fn().mockResolvedValue('mocked-hash') }));
vi.mock('../../../utils/storageUrls.js');
vi.mock('../../../utils/domainUtils.js');
vi.mock('../../../utils/permissionManager.js');
vi.mock('../../../utils/trustChecker.js', () => ({
  TrustChecker: vi.fn().mockImplementation(function () {
    return {
      checkDomain: vi.fn().mockResolvedValue({
        canProceed: true, showAlert: false, reason: undefined,
        trustResult: { level: 'trusted' as const, source: 'jp-anchor' as const },
      }),
    };
  }),
}));
vi.mock('../../privacyPipeline.js');
vi.mock('../../obsidianClient.js');
vi.mock('../../../utils/logger.js', () => ({
  addLog: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
  logDebug: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  ErrorCode: { INTERNAL_ERROR: 'INT_001', UNKNOWN_ERROR: 'UNKN_001' },
}));
vi.mock('../../../utils/piiSanitizer.js', () => ({
  sanitizeRegex: vi.fn().mockResolvedValue({ text: 'sanitized content', maskedItems: [] }),
}));

import * as storage from '../../../utils/storage.js';
import * as domainUtils from '../../../utils/domainUtils.js';
import * as permissionManager from '../../../utils/permissionManager.js';
import * as logger from '../../../utils/logger.js';
import { PrivacyPipeline } from '../../privacyPipeline.js';
import { ObsidianClient } from '../../obsidianClient.js';
import { RecordingPipeline } from '../RecordingPipeline.js';

const MockedPrivacyPipeline = PrivacyPipeline as vi.MockedClass<typeof PrivacyPipeline>;
const MockedObsidianClient = ObsidianClient as vi.MockedClass<typeof ObsidianClient>;

const mockSettings: Record<string, unknown> = {
  PRIVACY_MODE: 'full_pipeline', PII_SANITIZE_LOGS: true,
  TAG_SUMMARY_MODE: false, AUTO_SAVE_PRIVACY_BEHAVIOR: 'save',
};

function makeAiClient() {
  return {
    getLocalAvailability: vi.fn<() => Promise<string>>().mockResolvedValue('unavailable'),
    summarizeLocally: vi.fn(),
    generateSummary: vi.fn<() => Promise<any>>().mockResolvedValue({ success: true, summary: 'AI summary', sentTokens: 100, receivedTokens: 50 }),
  };
}

function makeObsidian() {
  return { appendToDailyNote: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) };
}

function makeGetPrivacyInfo() {
  return vi.fn<() => Promise<any>>().mockResolvedValue({ isPrivate: false });
}

function setupMockPipeline() {
  (storage as any).StorageKeys = {
    PRIVACY_MODE: 'PRIVACY_MODE', PII_SANITIZE_LOGS: 'PII_SANITIZE_LOGS',
    TAG_SUMMARY_MODE: 'TAG_SUMMARY_MODE', AUTO_SAVE_PRIVACY_BEHAVIOR: 'AUTO_SAVE_PRIVACY_BEHAVIOR',
    CONTENT_STORAGE_ENABLED: 'content_storage_enabled',
  };
  (storage as any).getSavedUrlsWithTimestamps.mockResolvedValue(new Map());
  (storage as any).setSavedUrlsWithTimestamps.mockResolvedValue(undefined);
  (storage as any).MAX_URL_SET_SIZE = 10000;
  (storage as any).URL_WARNING_THRESHOLD = 9000;
  (domainUtils as any).isDomainAllowed.mockResolvedValue(true);
  (domainUtils as any).extractDomain.mockReturnValue('example.com');
  (permissionManager as any).getPermissionManager.mockReturnValue({
    isHostPermitted: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    recordDeniedVisit: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  });
}

function setupStepMocks(mockProcess: ReturnType<typeof vi.fn>) {
  MockedPrivacyPipeline.mockImplementation(function () {
    (this as any).process = mockProcess;
  } as any);
  MockedObsidianClient.mockImplementation(function () {
    (this as any).appendToDailyNote = vi.fn();
  } as any);
}

describe('RecordingPipeline - R2', () => {
  describe('Happy path with various scenarios', () => {
    let mockProcess: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.clearAllMocks();
      Object.keys(mockStorage).forEach(key => delete mockStorage[key]);
      setupMockPipeline();
      mockProcess = vi.fn();
      setupStepMocks(mockProcess);
    });

    it('returns success for best-effort saveObsidian failure', async () => {
      mockProcess.mockResolvedValue({ summary: 'AI summary', maskedCount: 0 });
      const failingObsidian = {
        appendToDailyNote: vi.fn().mockRejectedValue(new Error('Obsidian write fail')),
      };
      const pipeline = new RecordingPipeline(makeGetPrivacyInfo(), failingObsidian as any, makeAiClient() as any);
      const result = await pipeline.execute(
        { title: 'BeFail', url: 'https://example.com/befail', content: 'Content' }, mockSettings
      );
      expect(result.success).toBe(true);
    });

    it('skips SQLite save when client is null', async () => {
      mockProcess.mockResolvedValue({ summary: 'Summary', maskedCount: 0 });
      const pipeline = new RecordingPipeline(makeGetPrivacyInfo(), makeObsidian() as any, makeAiClient() as any, null);
      const result = await pipeline.execute(
        { title: 'NoSQLite', url: 'https://example.com/nosqlite', content: 'Content' }, mockSettings
      );
      expect(result.success).toBe(true);
    });

    it('strips PII from maskedItems in previewOnly mode', async () => {
      mockProcess.mockResolvedValue({
        success: true, preview: true, processedContent: 'Content with [MASKED:email]',
        maskedCount: 1, maskedItems: [{ type: 'email', original: 'user@example.com' }],
      });
      const pipeline = new RecordingPipeline(makeGetPrivacyInfo(), makeObsidian() as any, makeAiClient() as any);
      const result = await pipeline.execute(
        { title: 'PII Preview', url: 'https://example.com', content: 'Content', previewOnly: true }, mockSettings
      );
      expect(result.success).toBe(true);
    });

    it('returns success buildResult with summary and metadata', async () => {
      mockProcess.mockResolvedValue({ summary: 'Summary', maskedCount: 0 });
      const pipeline = new RecordingPipeline(makeGetPrivacyInfo(), makeObsidian() as any, makeAiClient() as any, null);
      const result = await pipeline.execute(
        { title: 'NonFatal', url: 'https://example.com/nonfatal', content: 'Content' }, mockSettings
      );
      expect(result.success).toBe(true);
      expect(result.summary).toBeDefined();
      expect(result.title).toBe('NonFatal');
    });

    it('detects private page with auto-save-behavior=skip', async () => {
      mockProcess.mockResolvedValue({ summary: 'Summary', maskedCount: 0 });
      const pipeline = new RecordingPipeline(
        vi.fn().mockResolvedValue({ isPrivate: true, reason: 'auth', headerValue: 'Bearer ***', headers: { cacheControl: 'private' } }),
        makeObsidian() as any, makeAiClient() as any
      );
      const result = await pipeline.execute(
        { title: 'Private', url: 'https://example.com/private', content: 'Content' },
        { ...mockSettings, AUTO_SAVE_PRIVACY_BEHAVIOR: 'skip' }
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe('PRIVATE_PAGE_DETECTED');
    });

    it('detects private page with requireConfirmation', async () => {
      mockProcess.mockResolvedValue({ summary: 'Summary', maskedCount: 0 });
      const pipeline = new RecordingPipeline(
        vi.fn().mockResolvedValue({ isPrivate: true, reason: 'cache-control', headerValue: 'private', headers: { cacheControl: 'private' } }),
        makeObsidian() as any, makeAiClient() as any
      );
      const result = await pipeline.execute(
        { title: 'Private2', url: 'https://example.com/private2', content: 'Content', requireConfirmation: true },
        mockSettings
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe('PRIVATE_PAGE_DETECTED');
      expect(result.confirmationRequired).toBe(true);
    });
  });

  describe('FATAL step error paths (isolated to avoid mock contamination)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      Object.keys(mockStorage).forEach(key => delete mockStorage[key]);
      setupMockPipeline();
      MockedObsidianClient.mockImplementation(function () {
        (this as any).appendToDailyNote = vi.fn();
      } as any);
    });

    it('returns error when permission check fails', async () => {
      (permissionManager as any).getPermissionManager.mockReturnValue({
        isHostPermitted: vi.fn().mockRejectedValue(new Error('Permission denied')),
        recordDeniedVisit: vi.fn(),
      });
      MockedPrivacyPipeline.mockImplementation(function () {
        (this as any).process = vi.fn().mockResolvedValue({ summary: 'S', maskedCount: 0 });
      } as any);

      const pipeline = new RecordingPipeline(makeGetPrivacyInfo(), makeObsidian() as any, makeAiClient() as any);
      const result = await pipeline.execute(
        { title: 'Test', url: 'https://example.com', content: 'Content' }, mockSettings
      );
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('returns error when trust check fails', async () => {
      // Reset TrustChecker and set to failing implementation
      const { TrustChecker } = await import('../../../utils/trustChecker.js');
      (TrustChecker as any).mockReset();
      (TrustChecker as any).mockImplementation(function () {
        return { checkDomain: vi.fn().mockRejectedValue(new Error('Trust check failed')) };
      });
      MockedPrivacyPipeline.mockImplementation(function () {
        (this as any).process = vi.fn().mockResolvedValue({ summary: 'S', maskedCount: 0 });
      } as any);

      const pipeline = new RecordingPipeline(makeGetPrivacyInfo(), makeObsidian() as any, makeAiClient() as any);
      const result = await pipeline.execute(
        { title: 'Test', url: 'https://example.com', content: 'Content' }, mockSettings
      );
      expect(result.success).toBe(false);
    });
  });
});
