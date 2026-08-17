/**
 * Recording Pipeline
 * Orchestrates the recording process through a series of pipeline steps
 *
 * Step order and skip/bypass conditions (data.force / data.skipDuplicateCheck / data.previewOnly):
 *
 *   1. truncate            — always runs
 *   2. domainFilter        — blocked domain: FATAL unless force=true (force bypasses the block)
 *   3. permission          — always runs
 *   4. trust               — untrusted domain: FATAL unless force=true (force bypasses the check)
 *   5. privacyHeaders      — private-page headers detected: throws PrivatePageError unless force=true
 *                            (force bypasses the privacy-header block entirely)
 *   6. duplicate           — same-day duplicate: throws DuplicateError unless skipDuplicateCheck=true
 *                            (force does NOT bypass this — only skipDuplicateCheck does)
 *   7. privacyPipeline     — AI summary + PII masking; RETRY (max 3)
 *      → if data.previewOnly=true, execute() returns context.result immediately after this step
 *        (steps 8-12 below do not run in preview mode)
 *   8. extractSentences    — RETRY (max 3)
 *   9. formatMarkdown      — FATAL
 *  10. saveObsidian        — BEST_EFFORT (failure does not abort the pipeline)
 *  11. saveLocalMarkdown   — BEST_EFFORT
 *  12. saveSqlite          — BEST_EFFORT (no-op if sqliteClient is unavailable)
 *  13. saveMetadata        — BEST_EFFORT
 *
 * Flag combinations:
 *   - force + skipDuplicateCheck: both bypasses apply independently (force skips
 *     domain/trust/privacy-header blocks, skipDuplicateCheck skips the same-day check).
 *     This combination is used by the offline-network-queue retry path, which force-replays
 *     a page that a user already chose to record.
 *   - force + previewOnly: force bypasses steps 2/4/5, then privacyPipeline still runs and
 *     execute() returns early with the preview result — no write steps execute.
 *   - skipDuplicateCheck alone (force=false): domain/trust/privacy-header blocks still apply;
 *     only the same-day duplicate check is bypassed.
 */

import { addLog, LogType, logError, ErrorCode } from '../../utils/logger.js';
import { addPendingPage } from '../../utils/pendingStorage.js';
import { ErrorStrategy, type RecordingContext, type PipelineStep, type PipelineError, type OfflineJobKind, type StepDeps } from './types.js';
import { buildResult, buildErrorResult, buildPrivatePageResult, notifyObsidianSaveSuccess } from './resultBuilder.js';
import {
  truncateContentStep,
  checkDomainFilterStep,
  checkPermissionStep,
  checkTrustDomainStep,
  PrivacyHeadersChecker,
  PrivatePageError,
  checkDuplicateStep,
  DuplicateError,
  processPrivacyPipelineStep,
  extractSentencesStep,
  formatMarkdownStep,
  saveToObsidianStep,
  saveLocalMarkdownStep,
  saveMetadataStep,
  saveSqliteStep
} from './steps/index.js';
import type { RecordingData, RecordingResult } from '../../messaging/types.js';
import type { Settings } from '../../utils/storage.js';
import { stripPiiFromMaskedItems } from '../../utils/piiStripper.js';
import type { ObsidianClient } from '../obsidianClient.js';
import type { AIService } from '../ai/AIService.js';
import type { SqliteClient } from '../sqliteClient.js';
import { mapToBrowsingLogRecord } from './mappers/BrowsingLogRecordMapper.js';
import type { PrivacyInfo } from '../../utils/privacyChecker.js';
import { sharedOfflineNetworkQueue, type OfflineNetworkQueue } from '../offlineNetworkQueue.js';
import { Mutex } from '../../utils/Mutex.js';
import { RecordingCache } from '../recordingCache.js';

/**
 * Dependencies required to build a RecordingPipeline instance.
 */
export interface RecordingPipelineDeps {
  getPrivacyInfoWithCache: (url: string) => Promise<PrivacyInfo | null>;
  obsidian: ObsidianClient;
  aiService: AIService | null;
  sqliteClient: SqliteClient | null;
  offlineNetworkQueue?: OfflineNetworkQueue | null;
}

/**
 * Factory function that creates a fully configured RecordingPipeline.
 * Centralizes instance creation so callers do not need to invoke `new` directly.
 */
export function createRecordingPipeline(deps: RecordingPipelineDeps): RecordingPipeline {
  return new RecordingPipeline(
    deps.getPrivacyInfoWithCache,
    deps.obsidian,
    deps.aiService,
    deps.sqliteClient,
    deps.offlineNetworkQueue
  );
}

/**
 * Build the pipeline deps shared by every recording caller, wiring the
 * shared offline network queue singleton.
 *
 * Previously each caller (messageHandlers manual/save, recordingLogic) rebuilt
 * the same 5-field deps object inline, so adding or renaming a pipeline
 * dependency meant editing several call sites.
 */
export function buildRecordingPipelineDeps(
  deps: Pick<RecordingPipelineDeps, 'getPrivacyInfoWithCache' | 'obsidian' | 'aiService' | 'sqliteClient'>,
): RecordingPipelineDeps {
  return {
    ...deps,
    offlineNetworkQueue: sharedOfflineNetworkQueue,
  };
}

/**
 * Delay helper for retry strategy
 */
const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Recording Pipeline class
 * Manages the execution of recording steps with configurable error strategies.
 *
 * Owns per-URL mutex serialization (previously in RecordingLogic) to protect
 * the read-then-write window between checkDuplicateStep and saveMetadataStep.
 */
export class RecordingPipeline {
  private steps: PipelineStep[];
  private getPrivacyInfoWithCache: (url: string) => Promise<PrivacyInfo | null>;
  private obsidian: ObsidianClient;
  private aiService: AIService | null;
  private sqliteClient: SqliteClient | null;
  private offlineNetworkQueue: OfflineNetworkQueue | null;

  // Per-URL mutex map (VULN-003 fix: prevents TOCTOU races)
  private static urlRecordMutexes = new Map<string, Mutex>();

  private static getUrlMutex(url: string): Mutex {
    let mutex = RecordingPipeline.urlRecordMutexes.get(url);
    if (!mutex) {
      mutex = new Mutex({ maxQueueSize: 5, timeoutMs: 60000 });
      RecordingPipeline.urlRecordMutexes.set(url, mutex);
    }
    return mutex;
  }

  /**
   * Acquire the per-URL mutex, run fn, then release it.
   */
  private static async withUrlRecordMutex<T>(url: string, fn: () => Promise<T>): Promise<T> {
    const mutex = RecordingPipeline.getUrlMutex(url);
    try {
      await mutex.acquire();
      return await fn();
    } finally {
      mutex.release();
      if (!mutex.isLocked() && mutex.getQueueSize() === 0) {
        RecordingPipeline.urlRecordMutexes.delete(url);
      }
    }
  }

  constructor(
    getPrivacyInfoWithCache: (url: string) => Promise<PrivacyInfo | null>,
    obsidian: ObsidianClient,
    aiService: AIService | null = null,
    sqliteClient: SqliteClient | null = null,
    offlineNetworkQueue: OfflineNetworkQueue | null = null
  ) {
    this.getPrivacyInfoWithCache = getPrivacyInfoWithCache;
    this.obsidian = obsidian;
    this.aiService = aiService;
    this.sqliteClient = sqliteClient;
    this.offlineNetworkQueue = offlineNetworkQueue;

    // Define pipeline steps with their error strategies
    this.steps = [
      {
        name: 'truncate',
        errorStrategy: ErrorStrategy.FATAL,
        execute: truncateContentStep
      },
      {
        name: 'domainFilter',
        errorStrategy: ErrorStrategy.FATAL,
        execute: checkDomainFilterStep
      },
      {
        name: 'permission',
        errorStrategy: ErrorStrategy.FATAL,
        execute: checkPermissionStep
      },
      {
        name: 'trust',
        errorStrategy: ErrorStrategy.FATAL,
        execute: checkTrustDomainStep
      },
      {
        name: 'privacyHeaders',
        errorStrategy: ErrorStrategy.FATAL,
        execute: this.createPrivacyHeadersStep()
      },
      {
        name: 'duplicate',
        errorStrategy: ErrorStrategy.FATAL,
        execute: checkDuplicateStep
      },
      {
        name: 'privacyPipeline',
        errorStrategy: ErrorStrategy.RETRY,
        maxRetries: 3,
        offlineRetry: { jobKind: 'ai_summary' },
        previewBreakpoint: true,
        execute: processPrivacyPipelineStep
      },
      {
        name: 'extractSentences',
        errorStrategy: ErrorStrategy.RETRY,
        maxRetries: 3,
        offlineRetry: { jobKind: 'ai_summary' },
        execute: extractSentencesStep
      },
      {
        name: 'formatMarkdown',
        errorStrategy: ErrorStrategy.FATAL,
        execute: formatMarkdownStep
      },
      {
        name: 'saveObsidian',
        errorStrategy: ErrorStrategy.BEST_EFFORT,
        offlineRetry: { jobKind: 'obsidian_sync' },
        execute: this.createSaveToObsidianStep()
      },
      {
        name: 'saveLocalMarkdown',
        errorStrategy: ErrorStrategy.BEST_EFFORT,
        execute: saveLocalMarkdownStep
      },
      {
        name: 'saveSqlite',
        errorStrategy: ErrorStrategy.BEST_EFFORT,
        execute: this.createSaveSqliteStep()
      },
      {
        name: 'saveMetadata',
        errorStrategy: ErrorStrategy.BEST_EFFORT,
        execute: saveMetadataStep
      }
    ];
  }

  /**
   * Create privacy headers step with injected dependency
   */
  private createPrivacyHeadersStep() {
    const checker = new PrivacyHeadersChecker(this.getPrivacyInfoWithCache);
    return (context: RecordingContext, _deps?: StepDeps) => checker.execute(context);
  }

  /**
   * Create save to Obsidian step with injected dependency
   */
  private createSaveToObsidianStep() {
    const deps: StepDeps = { obsidian: this.obsidian, aiService: this.aiService! };
    return (context: RecordingContext) => saveToObsidianStep(context, deps);
  }

  /**
   * Create save to SQLite step with injected dependency
   */
  private createSaveSqliteStep() {
    return async (context: RecordingContext, _deps?: StepDeps): Promise<RecordingContext> => {
      if (!this.sqliteClient) {
        addLog(LogType.WARN, 'No SqliteClient available, skipping SQLite save', {
          url: context.data.url,
          traceId: context.traceId
        });
        return context;
      }

      const record = mapToBrowsingLogRecord(context);
      await saveSqliteStep({
        recordId: 0,
        record,
        sqliteClient: this.sqliteClient,
        obsidianSynced: context.obsidianDuration !== undefined ? true : undefined,
        traceId: context.traceId
      });

      addLog(LogType.INFO, 'Saved to SQLite', { url: context.data.url, title: context.data.title, traceId: context.traceId });
      return context;
    };
  }

  /**
   * Execute the pipeline with initial data.
   * Acquires per-URL mutex to protect the read-then-write window.
   */
  async execute(data: RecordingData, settings: Settings): Promise<RecordingResult> {
    return RecordingPipeline.withUrlRecordMutex(data.url, async () => {
      return this.executeInternal(data, settings);
    });
  }

  /**
   * Retry an Obsidian write for an offline-queued job.
   * Reuses the pipeline's formatMarkdown + saveObsidian steps instead of
   * calling them manually (previously in RecordingLogic.retryObsidianWriteOnly).
   */
  async retryObsidianWriteOnly(job: {
    title: string;
    url: string;
    summary: string;
    tags?: string[];
  }): Promise<boolean> {
    return RecordingPipeline.withUrlRecordMutex(job.url, async () => {
      const settings = await RecordingCache.getSettingsWithCache();
      const context: RecordingContext = {
        data: { title: job.title, url: job.url, content: '' } as RecordingData,
        settings,
        force: true,
        errors: [],
        privacyResult: { summary: job.summary, tags: job.tags },
      };

      // Run only formatMarkdown + saveObsidian steps (the retry path)
      const deps: StepDeps = { obsidian: this.obsidian, aiService: this.aiService! };
      let result = await formatMarkdownStep(context);
      result = await saveToObsidianStep(result, deps);

      // Notify user on successful offline retry save
      if (result.obsidianDuration != null) {
        notifyObsidianSaveSuccess(job.title);
      }

      return true;
    });
  }

  private async executeInternal(data: RecordingData, settings: Settings): Promise<RecordingResult> {
    // Create initial context with a trace ID for cross-step log correlation
    const traceId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : (() => { const a = new Uint32Array(2); if (typeof crypto !== 'undefined') crypto.getRandomValues(a); return a[0].toString(36) + a[1].toString(36); })();

    // Build deps once per recording event (not per step)
    const deps: StepDeps = {
      obsidian: this.obsidian,
      aiService: this.aiService!,
    };

    let context: RecordingContext = {
      data,
      settings,
      force: data.force || false,
      aiService: this.aiService,
      traceId,
      errors: [],
    };

    // Execute each step
    for (const step of this.steps) {
      try {
        context = await this.executeWithStrategy(step, context, deps);

        // previewOnly: privacyPipeline ステップ完了後に早期リターン
        if (data.previewOnly && context.result && step.previewBreakpoint) {
          // PII保護: maskedItemsからoriginalフィールドを削除してからレスポンスを返す
          if (context.result.maskedItems && Array.isArray(context.result.maskedItems)) {
            context.result.maskedItems = stripPiiFromMaskedItems(context.result.maskedItems);
          }
          return context.result;
        }
      } catch (error) {
        // Handle special error types
        if (error instanceof PrivatePageError) {
          return buildPrivatePageResult(context, error);
        }

        if (error instanceof DuplicateError) {
          return {
            success: true,
            skipped: true,
            reason: error.reason,
            title: data.title,
            url: data.url
          };
        }

        // Handle error based on strategy
        if (step.errorStrategy === ErrorStrategy.FATAL || step.errorStrategy === ErrorStrategy.RETRY) {
          return buildErrorResult(context, error as Error, step.name);
        }

        // SILENT / BEST_EFFORT - log and continue
        const pipelineError: PipelineError = {
          step: step.name,
          error: error as Error,
          strategy: step.errorStrategy,
          timestamp: Date.now(),
          recoveryKind: step.offlineRetry?.jobKind,
          context: {
            url: context.data.url,
            tabId: (context.data as unknown as Record<string, unknown>).tabId as number | undefined
          }
        };

        context.errors.push(pipelineError);

        addLog(LogType.WARN, `Pipeline step ${step.name} failed with ${step.errorStrategy} strategy`, {
          error: (error as Error).message,
          url: data.url,
          traceId: context.traceId
        });
      }
    }

    // Build final result
    const result = buildResult(context);

    // Notify user on successful Obsidian save
    if (result.success && result.obsidianDuration != null) {
      notifyObsidianSaveSuccess(data.title);
    }

    return result;
  }

  /**
   * Execute a step with retry logic if configured
   */
  private async executeWithStrategy(
    step: PipelineStep,
    context: RecordingContext,
    deps: StepDeps
  ): Promise<RecordingContext> {
    let retries = 0;

    while (true) {
      try {
        return await step.execute(context, deps);
      } catch (error) {
        if (step.errorStrategy === ErrorStrategy.RETRY && retries < (step.maxRetries || 0)) {
          retries++;
          const delayMs = Math.min(Math.pow(2, retries) * 1000, 5000); // Exponential backoff with 5s cap
          addLog(LogType.INFO, `Retrying step ${step.name} (attempt ${retries}/${step.maxRetries})`, {
            delayMs,
            url: context.data.url,
            traceId: context.traceId
          });
          await delay(delayMs);
          continue;
        }

        // Queue network-dependent steps for later retry when offline/retry limit is reached.
        if (this.offlineNetworkQueue) {
          await this.enqueueOfflineJob(step, context);
        }

        throw error;
      }
    }
  }

  private async enqueueOfflineJob(
    step: PipelineStep,
    context: RecordingContext
  ): Promise<void> {
    if (!step.offlineRetry) {
      return;
    }

    const type: OfflineJobKind = step.offlineRetry.jobKind;

    const payload = {
      title: context.data.title,
      url: context.data.url,
      content: context.data.content,
      summary: context.privacyResult?.summary,
      maskedCount: context.privacyResult?.maskedCount,
      tags: context.privacyResult?.tags,
    };

    try {
      await this.offlineNetworkQueue!.enqueue({ type, payload });
      addLog(LogType.INFO, `RecordingPipeline: queued offline job for ${step.name}`, {
        url: context.data.url,
        type,
        traceId: context.traceId,
      });
    } catch (enqueueError) {
      addLog(LogType.ERROR, 'RecordingPipeline: failed to enqueue offline job', {
        url: context.data.url,
        type,
        error: enqueueError instanceof Error ? enqueueError.message : String(enqueueError),
        traceId: context.traceId,
      });
    }
  }
}
