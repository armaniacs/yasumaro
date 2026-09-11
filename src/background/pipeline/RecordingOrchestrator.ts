/**
 * RecordingOrchestrator — deep module hiding 13 steps + PerUrlMutex + PipelineKernel
 *
 * Interface is three entry points:
 * - record(data, opts) -> RecordingResult (full 13 steps)
 * - preview(data, opts) -> RecordingResult (previewBreakpoint short-circuit)
 * - retryObsidianWrite(job) -> boolean (2-step retry, no AI re-run)
 *
 * Deletion test: deleting this module forces 13 step registrations + mutex +
 * kernel to reappear in every caller. Deleting a shallow factory only moves one line.
 */

import { addLog, LogType } from '../../utils/logger.js';
import { ErrorStrategy, type RecordingContext, type PipelineStep, type StepDeps, type UrlStore } from './types.js';
import { decideStepOutcome, defaultOutcomeAdapters, finalizeSuccess, type OutcomeAdapters } from './recordingOutcome.js';
import { toExternalResult } from './piiBoundary.js';
import { createRetryContext, createSaveSqliteParams, createStepDeps } from './contextBuilder.js';
import {
  truncateContentStep, checkDomainFilterStep, checkPermissionStep, checkTrustDomainStep,
  PrivacyHeadersChecker, checkDuplicateStep,
  processPrivacyPipelineStep, extractSentencesStep, formatMarkdownStep,
  saveToObsidianStep, saveLocalMarkdownStep, saveMetadataStep, saveSqliteStep
} from './steps/index.js';
import type { RecordingData, RecordingResult } from '../../messaging/types.js';
import type { Settings } from '../../utils/storage/types.js';
import type { ObsidianClient } from '../obsidianClient.js';
import type { AIService } from '../ai/AIService.js';
import type { SqliteClient } from '../sqlite/offscreenGateway.js';
import { mapToBrowsingLogRecord } from './mappers/BrowsingLogRecordMapper.js';
import type { PrivacyInfo } from '../../utils/privacyChecker.js';
import type { OfflineNetworkQueue } from '../offlineNetworkQueue.js';
import { PerUrlMutexMap } from './perUrlMutex.js';
import { StepExecutor } from './stepExecutor.js';

export interface RecordingOrchestratorDeps {
  getPrivacyInfoWithCache: (url: string) => Promise<PrivacyInfo | null>;
  getSettingsWithCache: () => Promise<Settings>;
  obsidian: ObsidianClient;
  aiService: AIService | null;
  sqliteClient: SqliteClient | null;
  offlineNetworkQueue?: OfflineNetworkQueue | null;
  urlStore?: UrlStore;
  perUrlMutexMap?: PerUrlMutexMap;
  outcomeAdapters?: OutcomeAdapters;
}

export interface RecordOptions {
  previewOnly?: boolean;
  /**
   * Explicit settings, bypassing getSettingsWithCache. Used by the
   * manual/preview record handlers which have already resolved settings and
   * must not race a concurrent cache refresh.
   */
  settings?: Settings;
}

export class RecordingOrchestrator {
  private steps: PipelineStep[];
  private retrySteps: PipelineStep[];
  private getPrivacyInfoWithCache: (url: string) => Promise<PrivacyInfo | null>;
  private getSettingsWithCache: () => Promise<Settings>;
  private obsidian: ObsidianClient;
  private aiService: AIService | null;
  private sqliteClient: SqliteClient | null;
  private urlStore: UrlStore | undefined;
  private mutexMap: PerUrlMutexMap;
  private executor: StepExecutor;
  private outcomeAdapters: OutcomeAdapters;

  constructor(deps: RecordingOrchestratorDeps) {
    this.getPrivacyInfoWithCache = deps.getPrivacyInfoWithCache;
    this.getSettingsWithCache = deps.getSettingsWithCache;
    this.obsidian = deps.obsidian;
    this.aiService = deps.aiService;
    this.sqliteClient = deps.sqliteClient;
    this.urlStore = deps.urlStore;
    this.mutexMap = deps.perUrlMutexMap ?? new PerUrlMutexMap();
    this.executor = new StepExecutor(deps.offlineNetworkQueue ?? null);
    this.outcomeAdapters = deps.outcomeAdapters ?? defaultOutcomeAdapters;

    this.steps = [
      { name: 'truncate', errorStrategy: ErrorStrategy.FATAL, execute: truncateContentStep },
      { name: 'domainFilter', errorStrategy: ErrorStrategy.FATAL, execute: checkDomainFilterStep },
      { name: 'permission', errorStrategy: ErrorStrategy.FATAL, execute: checkPermissionStep },
      { name: 'trust', errorStrategy: ErrorStrategy.FATAL, execute: checkTrustDomainStep },
      { name: 'privacyHeaders', errorStrategy: ErrorStrategy.FATAL, execute: this.createPrivacyHeadersStep() },
      { name: 'duplicate', errorStrategy: ErrorStrategy.FATAL, execute: checkDuplicateStep },
      { name: 'privacyPipeline', errorStrategy: ErrorStrategy.RETRY, maxRetries: 3, offlineRetry: { jobKind: 'ai_summary' }, previewBreakpoint: true, execute: processPrivacyPipelineStep },
      { name: 'extractSentences', errorStrategy: ErrorStrategy.RETRY, maxRetries: 3, offlineRetry: { jobKind: 'ai_summary' }, execute: extractSentencesStep },
      { name: 'formatMarkdown', errorStrategy: ErrorStrategy.FATAL, execute: formatMarkdownStep },
      { name: 'saveObsidian', errorStrategy: ErrorStrategy.BEST_EFFORT, offlineRetry: { jobKind: 'obsidian_sync' }, execute: this.createSaveToObsidianStep() },
      { name: 'saveLocalMarkdown', errorStrategy: ErrorStrategy.BEST_EFFORT, execute: saveLocalMarkdownStep },
      { name: 'saveSqlite', errorStrategy: ErrorStrategy.BEST_EFFORT, execute: this.createSaveSqliteStep() },
      { name: 'saveMetadata', errorStrategy: ErrorStrategy.BEST_EFFORT, execute: saveMetadataStep }
    ];

    // Retry pipeline is a distinct 2-step subset compiled at construction — not inline in record()
    this.retrySteps = [
      { name: 'formatMarkdown', errorStrategy: ErrorStrategy.FATAL, execute: formatMarkdownStep },
      { name: 'saveObsidian', errorStrategy: ErrorStrategy.BEST_EFFORT, offlineRetry: { jobKind: 'obsidian_sync' }, execute: this.createSaveToObsidianStep() },
    ];
  }

  private createPrivacyHeadersStep() {
    const checker = new PrivacyHeadersChecker(this.getPrivacyInfoWithCache);
    return (context: RecordingContext, _deps?: StepDeps) => checker.execute(context);
  }

  private createSaveToObsidianStep() {
    const deps: StepDeps = { obsidian: this.obsidian, aiService: this.aiService! };
    return (context: RecordingContext) => saveToObsidianStep(context, deps);
  }

  private createSaveSqliteStep() {
    // Deps are construction-time fixed; no fallback to `this.sqliteClient` — caller must provide via StepDeps
    return async (context: RecordingContext, deps?: StepDeps): Promise<RecordingContext> => {
      const client = deps?.sqliteClient as SqliteClient | null | undefined;
      if (!client) {
        addLog(LogType.WARN, 'No SqliteClient available, skipping SQLite save', { url: context.data.url, traceId: context.traceId });
        return context;
      }
      const record = mapToBrowsingLogRecord(context);
      const params = createSaveSqliteParams({
        recordId: 0,
        record,
        sqliteClient: client,
        obsidianSynced: context.obsidianDuration !== undefined ? true : undefined,
        traceId: context.traceId,
      });
      await saveSqliteStep(params);
      addLog(LogType.INFO, 'Saved to SQLite', { url: context.data.url, title: context.data.title, traceId: context.traceId });
      return context;
    };
  }

  private generateTraceId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    const a = new Uint32Array(2);
    if (typeof crypto !== 'undefined') crypto.getRandomValues(a);
    return (a[0] ?? 0).toString(36) + (a[1] ?? 0).toString(36);
  }

  /**
   * Normal path: full 13 steps. Preview requests must use `preview()` —
   * the `previewOnly` data flag short-circuits at the previewBreakpoint step.
   */
  async record(data: RecordingData, opts: RecordOptions = {}): Promise<RecordingResult> {
    if (opts.previewOnly || (data as { previewOnly?: boolean }).previewOnly) return this.preview(data, opts);
    const settings = opts.settings ?? await this.getSettingsWithCache();
    return this.mutexMap.runExclusive(data.url, () => this.executeInternal(data, settings));
  }

  /** Preview path: short-circuit after privacyPipeline (previewBreakpoint) */
  async preview(data: RecordingData, opts: RecordOptions = {}): Promise<RecordingResult> {
    const settings = opts.settings ?? await this.getSettingsWithCache();
    const effectiveData = { ...data, previewOnly: true } as RecordingData;
    return this.mutexMap.runExclusive(effectiveData.url, () => this.executeInternal(effectiveData, settings));
  }

  private async executeRetrySubset(context: RecordingContext, deps: StepDeps, traceId: string): Promise<RecordingContext> {
    let ctx = { ...context, traceId } as RecordingContext;
    for (const step of this.retrySteps) {
      ctx = await this.executor.executeWithStrategy(step, ctx, deps);
    }
    return ctx;
  }

  /**
   * Distinct entry point: retry Obsidian write only (no AI re-run).
   * Uses the 2-step subset compiled at construction (`retrySteps`) via `executeRetrySubset`;
   * `RecordingOrchestrator.steps` (13 elements) is not touched.
   */
  async retryObsidianWrite(job: { title: string; url: string; summary: string; tags?: string[] }): Promise<boolean> {
    return this.mutexMap.runExclusive(job.url, async () => {
      const settings = await this.getSettingsWithCache();
      const traceId = this.generateTraceId();
      const context = createRetryContext(job, settings, traceId);
      const deps = createStepDeps({
        obsidian: this.obsidian,
        aiService: this.aiService,
        urlStore: this.urlStore,
        sqliteClient: this.sqliteClient,
      });
      const retryResult = await this.executeRetrySubset(context, deps, traceId);
      if ((retryResult as unknown as RecordingContext).obsidianDuration != null) {
        this.outcomeAdapters.notifier.notifySaveSuccess(job.title || job.url);
        return true;
      }
      return false;
    });
  }

  /**
   * Sole state owner of pipeline execution — formerly PipelineKernel (20-line
   * thin loop). Owns the step loop and BEST_EFFORT continuation; the outcome
   * policy (PrivatePage/Duplicate special cases, FATAL/RETRY mapping, pending
   * recovery, notices) lives in `recordingOutcome` and is driven through
   * injected adapters.
   */
  private async executeInternal(data: RecordingData, settings: Settings): Promise<RecordingResult> {
    const traceId = this.generateTraceId();
    const deps = createStepDeps({
      obsidian: this.obsidian,
      aiService: this.aiService,
      urlStore: this.urlStore,
      sqliteClient: this.sqliteClient,
    });
    let context: RecordingContext = { data, settings, force: data.force || false, aiService: deps.aiService as never, traceId, errors: [] };

    for (const step of this.steps) {
      try {
        context = await this.executor.executeWithStrategy(step, context, deps);
        if (data.previewOnly && context.result && step.previewBreakpoint) return toExternalResult(context.result);
      } catch (error) {
        // Outcome policy owns the error taxonomy + pending + notice.
        // BEST_EFFORT returns { done: false } so the loop continues.
        const outcome = decideStepOutcome(error, step, context, this.outcomeAdapters);
        if (outcome.done) return outcome.result;
        context.errors.push(outcome.pipelineError);
        addLog(LogType.WARN, `Pipeline step ${step.name} failed with ${step.errorStrategy} strategy`, { error: (error as Error).message, url: data.url, traceId: context.traceId });
      }
    }

    return finalizeSuccess(context, this.outcomeAdapters);
  }
}

export function createRecordingOrchestrator(deps: RecordingOrchestratorDeps): RecordingOrchestrator {
  return new RecordingOrchestrator(deps);
}
