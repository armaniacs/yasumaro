/**
 * RecordingLogic
 * Recording orchestration: pipeline execution, per-URL mutex, session state.
 *
 * Caching logic extracted to RecordingCache (PBI-2026-08-08-01).
 * Validation/truncation extracted to RecordingValidator.
 */

import type { RecordType, AiSummaryCleansedReason } from '../utils/commonTypes.js';
import { ObsidianClient } from './obsidianClient.js';
import type { AIService } from './ai/AIService.js';
import type { SqliteClient } from './sqliteClient.js';
import type { RecordingResult } from '../messaging/types.js';
import type { RecordingPipeline } from './pipeline/RecordingPipeline.js';
import { Mutex } from '../utils/Mutex.js';
import { formatMarkdownStep } from './pipeline/steps/formatMarkdownStep.js';
import { saveToObsidianStep } from './pipeline/steps/saveToObsidianStep.js';
import type { RecordingContext } from './pipeline/types.js';
import { RecordingCache } from './recordingCache.js';

// Re-export RecordingCache for backward compatibility
export { RecordingCache } from './recordingCache.js';
export { SETTINGS_CACHE_TTL } from './recordingCache.js';
export { redactSettingsApiKeys } from './recordingCache.js';
export { truncateContentSize, isValidFetchUrl, MAX_RECORD_SIZE } from './recordingValidator.js';

/**
 * Recording data input for the pipeline.
 */
export interface RecordingData {
  title: string;
  url: string;
  content: string;
  force?: boolean;
  skipDuplicateCheck?: boolean;
  alreadyProcessed?: boolean;
  previewOnly?: boolean;
  requireConfirmation?: boolean;
  headerValue?: string;
  recordType?: RecordType;
  maskedCount?: number;
  skipAi?: boolean;
  pageBytes?: number;
  candidateBytes?: number;
  originalBytes?: number;
  cleansedBytes?: number;
  aiSummaryOriginalBytes?: number;
  aiSummaryCleansedBytes?: number;
  aiSummaryCleansedElements?: number;
  aiSummaryCleansedReason?: AiSummaryCleansedReason;
  aiSummaryCleansedReasons?: string[];
  fallbackTriggered?: boolean;
  precomputedMaskedCount?: number;
}

/**
 * Recording orchestration.
 * Manages per-URL mutex and delegates to RecordingPipeline.
 */
export class RecordingLogic {
  // =========================================================================
  // Instance methods
  // =========================================================================
  // Per-URL mutex map (VULN-003 fix: prevents TOCTOU races)
  private static urlRecordMutexes = new Map<string, Mutex>();

  private static getUrlMutex(url: string): Mutex {
    let mutex = RecordingLogic.urlRecordMutexes.get(url);
    if (!mutex) {
      mutex = new Mutex({ maxQueueSize: 5, timeoutMs: 60000 });
      RecordingLogic.urlRecordMutexes.set(url, mutex);
    }
    return mutex;
  }

  /**
   * Acquire the per-URL mutex, run fn, then release it.
   */
  private static async withUrlRecordMutex<T>(url: string, fn: () => Promise<T>): Promise<T> {
    const mutex = RecordingLogic.getUrlMutex(url);
    try {
      await mutex.acquire();
      return await fn();
    } finally {
      mutex.release();
      if (!mutex.isLocked() && mutex.getQueueSize() === 0) {
        RecordingLogic.urlRecordMutexes.delete(url);
      }
    }
  }

  private obsidian: ObsidianClient;
  private aiService: AIService;
  private sqliteClient: SqliteClient | null;
  private pipeline: RecordingPipeline;

  constructor(
    obsidianClient: ObsidianClient,
    aiService: AIService,
    pipeline: RecordingPipeline,
    sqliteClient?: SqliteClient | null,
  ) {
    this.obsidian = obsidianClient;
    this.aiService = aiService;
    this.sqliteClient = sqliteClient || null;
    this.pipeline = pipeline;
  }

  // =========================================================================
  // Instance methods (recording orchestration)
  // =========================================================================

  /**
   * Retry an Obsidian write for an offline-queued job.
   */
  async retryObsidianWriteOnly(job: {
    title: string;
    url: string;
    summary: string;
    tags?: string[];
  }): Promise<boolean> {
    return RecordingLogic.withUrlRecordMutex(job.url, async () => {
      const settings = await RecordingCache.getSettingsWithCache();
      let context: RecordingContext = {
        data: { title: job.title, url: job.url, content: '' } as RecordingData,
        settings,
        force: true,
        errors: [],
        privacyResult: { summary: job.summary, tags: job.tags },
      };

      context = await formatMarkdownStep(context);
      context = await saveToObsidianStep(context, this.obsidian);
      return true;
    });
  }

  async record(data: RecordingData): Promise<RecordingResult> {
    return RecordingLogic.withUrlRecordMutex(data.url, async () => {
      const settings = await RecordingCache.getSettingsWithCache();
      return await this.pipeline.execute(data, settings);
    });
  }

  async recordWithPreview(data: RecordingData): Promise<RecordingResult> {
    const result = await this.record({ ...data, previewOnly: true });
    return result;
  }
}
