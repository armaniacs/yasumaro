/**
 * Tests for the offline retry policy declared via step metadata.
 *
 * PBI-05: Verifies that steps with offlineRetry metadata trigger offline
 * queue enqueue, steps without it do not, and the jobKind routes correctly.
 *
 * Mock setup mirrors RecordingPipeline.test.ts so the pipeline executes
 * through the full step chain (including the PrivacyPipeline class).
 */

import { vi } from 'vitest';

// Mock chrome.storage.local for pendingStorage integration
const mockStorage: Record<string, unknown> = {};
globalThis.chrome = {
  ...(globalThis.chrome || {}),
  storage: {
    ...((globalThis.chrome as any)?.storage || {}),
    local: {
      get: vi.fn((keys: string | string[] | null | undefined) => {
        if (keys === null || keys === undefined) {
          return Promise.resolve({ ...mockStorage });
        }
        if (Array.isArray(keys)) {
          const result: Record<string, unknown> = {};
          for (const key of keys) {
            if (key in mockStorage) {
              result[key] = mockStorage[key];
            }
          }
          return Promise.resolve(result);
        }
        if (typeof keys === 'string') {
          return Promise.resolve({ [keys]: mockStorage[keys] });
        }
        return Promise.resolve({});
      }),
      set: vi.fn((items: Record<string, unknown>) => {
        Object.assign(mockStorage, items);
        return Promise.resolve();
      }),
      remove: vi.fn((keys: string | string[]) => {
        const keysArr = Array.isArray(keys) ? keys : [keys];
        for (const key of keysArr) {
          delete mockStorage[key];
        }
        return Promise.resolve();
      }),
    },
  },
} as any;

vi.mock('../../../utils/storage.js');
vi.mock('../../../utils/errorUtils.js', () => ({
  errorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));
vi.mock('../../../utils/pendingStorage.js', () => ({
  addPendingPage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../utils/crypto/index.js', () => ({
  hashUrl: vi.fn().mockResolvedValue('mocked-hash'),
}));
vi.mock('../../../utils/storageUrls.js');
vi.mock('../../../utils/domainUtils.js');
vi.mock('../../../utils/permissionManager.js');
vi.mock('../../../utils/trustChecker.js', () => ({
  TrustChecker: vi.fn().mockImplementation(function () {
    return {
      checkDomain: vi.fn().mockResolvedValue({
        canProceed: true,
        showAlert: false,
        reason: undefined,
        trustResult: { level: 'trusted', source: 'jp-anchor' as const },
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
  sanitizeRegex: vi.fn().mockResolvedValue({ text: 'sanitized', maskedItems: [] }),
}));

import * as storage from '../../../utils/storage.js';
import * as domainUtils from '../../../utils/domainUtils.js';
import * as permissionManager from '../../../utils/permissionManager.js';
import { PrivacyPipeline } from '../../privacyPipeline.js';
import { ObsidianClient } from '../../obsidianClient.js';
import { RecordingPipeline } from '../RecordingPipeline.js';

const MockedObsidianClient = ObsidianClient as vi.MockedClass<typeof ObsidianClient>;
const MockedPrivacyPipeline = PrivacyPipeline as vi.MockedClass<typeof PrivacyPipeline>;

const mockSettings = {
  PRIVACY_MODE: 'full_pipeline',
  PII_SANITIZE_LOGS: true,
  TAG_SUMMARY_MODE: false,
  AUTO_SAVE_PRIVACY_BEHAVIOR: 'save',
};

function makeAiClient() {
  return {
    getSupportedModes: vi.fn<() => string[]>().mockReturnValue(['full_pipeline']),
    generateSummary: vi.fn<() => Promise<any>>().mockResolvedValue({
      summary: 'AI summary',
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

function makeOfflineQueue() {
  return { enqueue: vi.fn().mockResolvedValue(undefined) };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Clear mockStorage between tests to prevent pending entries from accumulating
  Object.keys(mockStorage).forEach(key => delete mockStorage[key]);

  // @ts-expect-error - mock
  storage.StorageKeys = {
    PRIVACY_MODE: 'PRIVACY_MODE',
    PII_SANITIZE_LOGS: 'PII_SANITIZE_LOGS',
    TAG_SUMMARY_MODE: 'TAG_SUMMARY_MODE',
    AUTO_SAVE_PRIVACY_BEHAVIOR: 'AUTO_SAVE_PRIVACY_BEHAVIOR',
  };
  // @ts-expect-error - mock
  storage.getSavedUrlsWithTimestamps.mockResolvedValue(new Map());
  // @ts-expect-error - mock
  storage.setSavedUrlsWithTimestamps.mockResolvedValue(undefined);
  // @ts-expect-error - mock
  storage.MAX_URL_SET_SIZE = 10000;
  // @ts-expect-error - mock
  storage.URL_WARNING_THRESHOLD = 9000;

  // @ts-expect-error - mock
  domainUtils.isDomainAllowed.mockResolvedValue(true);
  // @ts-expect-error - mock
  domainUtils.extractDomain.mockReturnValue('example.com');

  // @ts-expect-error - mock
  permissionManager.getPermissionManager.mockReturnValue({
    isHostPermitted: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    recordDeniedVisit: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  });
});

describe('Offline retry policy via step metadata', () => {
  let mockProcess: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProcess = vi.fn();
    MockedPrivacyPipeline.mockImplementation(function() {
      this.process = mockProcess;
    });
    MockedObsidianClient.mockImplementation(function() {
      this.appendToDailyNote = vi.fn();
    });
  });

  describe('offlineRetry metadata declaration', () => {
    it('has offlineRetry on exactly the expected steps', () => {
      const pipeline = new RecordingPipeline(
        makeGetPrivacyInfo(),
        makeObsidian() as any,
        makeAiClient() as any,
        null,
        makeOfflineQueue() as any,
      );

      const stepsWithOfflineRetry = (pipeline as any).steps
        .filter((s: any) => s.offlineRetry)
        .map((s: any) => ({ name: s.name, jobKind: s.offlineRetry.jobKind }));

      expect(stepsWithOfflineRetry).toEqual([
        { name: 'privacyPipeline', jobKind: 'ai_summary' },
        { name: 'extractSentences', jobKind: 'ai_summary' },
        { name: 'saveObsidian', jobKind: 'obsidian_sync' },
      ]);
    });

    it('all other steps have no offlineRetry metadata', () => {
      const pipeline = new RecordingPipeline(
        makeGetPrivacyInfo(),
        makeObsidian() as any,
        makeAiClient() as any,
        null,
        makeOfflineQueue() as any,
      );

      const stepsWithoutOfflineRetry = (pipeline as any).steps
        .filter((s: any) => !s.offlineRetry)
        .map((s: any) => s.name);

      expect(stepsWithoutOfflineRetry).toEqual([
        'truncate',
        'domainFilter',
        'permission',
        'trust',
        'privacyHeaders',
        'duplicate',
        'formatMarkdown',
        'saveLocalMarkdown',
        'saveSqlite',
        'saveMetadata',
      ]);
    });
  });

  describe('enqueueOfflineJob behavior via executeWithStrategy', () => {
    it('saveObsidian failure enqueues obsidian_sync job', async () => {
      mockProcess.mockResolvedValue({ summary: 'AI summary', maskedCount: 0 });

      const offlineQueue = makeOfflineQueue();
      const failingObsidian = {
        appendToDailyNote: vi.fn<() => Promise<void>>().mockRejectedValue(new Error('Connection refused')),
      };

      const pipeline = new RecordingPipeline(
        makeGetPrivacyInfo(),
        failingObsidian as any,
        makeAiClient() as any,
        null,
        offlineQueue as any,
      );

      const result = await pipeline.execute({
        title: 'Offline Test',
        url: 'https://example.com/offline',
        content: 'Content',
      }, mockSettings);

      // saveObsidian is BEST_EFFORT so pipeline should still succeed
      expect(result.success).toBe(true);
      // The offline queue should have been called with obsidian_sync
      expect(offlineQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'obsidian_sync' }),
      );
    });

    it('enqueues the payload shape offlineQueueProcessor reads back', async () => {
      // Producer/consumer contract: offlineQueueProcessor destructures exactly
      // these fields off job.payload. A rename here silently breaks retries.
      mockProcess.mockResolvedValue({ summary: 'AI summary', maskedCount: 3, tags: ['x'] });

      const offlineQueue = makeOfflineQueue();
      const failingObsidian = {
        appendToDailyNote: vi.fn<() => Promise<void>>().mockRejectedValue(new Error('Connection refused')),
      };

      const pipeline = new RecordingPipeline(
        makeGetPrivacyInfo(),
        failingObsidian as any,
        makeAiClient() as any,
        null,
        offlineQueue as any,
      );

      await pipeline.execute({
        title: 'Payload Shape',
        url: 'https://example.com/payload',
        content: 'Body content',
      }, mockSettings);

      expect(offlineQueue.enqueue).toHaveBeenCalledWith({
        type: 'obsidian_sync',
        payload: {
          title: 'Payload Shape',
          url: 'https://example.com/payload',
          content: 'Body content',
          summary: 'AI summary',
          maskedCount: 3,
          tags: ['x'],
        },
      });
    });

    it('saveObsidian failure without offlineNetworkQueue does not crash', async () => {
      mockProcess.mockResolvedValue({ summary: 'AI summary', maskedCount: 0 });

      const failingObsidian = {
        appendToDailyNote: vi.fn<() => Promise<void>>().mockRejectedValue(new Error('Offline')),
      };

      const pipeline = new RecordingPipeline(
        makeGetPrivacyInfo(),
        failingObsidian as any,
        makeAiClient() as any,
        null,
        null, // no offline queue
      );

      const result = await pipeline.execute({
        title: 'Offline Test 2',
        url: 'https://example.com/offline2',
        content: 'Content',
      }, mockSettings);

      expect(result.success).toBe(true);
    });

    it('privacyPipeline failure enqueues ai_summary job', async () => {
      // privacyPipeline uses mockProcess; make it reject to exhaust retries
      mockProcess.mockRejectedValue(new Error('AI unavailable'));

      const offlineQueue = makeOfflineQueue();

      const pipeline = new RecordingPipeline(
        makeGetPrivacyInfo(),
        makeObsidian() as any,
        makeAiClient() as any,
        null,
        offlineQueue as any,
      );

      const result = await pipeline.execute({
        title: 'AI Fail Test',
        url: 'https://example.com/ai-fail',
        content: 'Content',
      }, mockSettings);

      // privacyPipeline is RETRY with maxRetries=3, exhausts retries,
      // then throws → pipeline returns error result
      expect(result.success).toBe(false);
      // ai_summary should have been enqueued
      expect(offlineQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ai_summary' }),
      );
    });
  });
});
