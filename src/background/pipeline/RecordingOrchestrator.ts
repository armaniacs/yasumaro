/**
 * RecordingOrchestrator — deep module hiding 13 steps + PerUrlMutex + PipelineKernel
 *
 * Interface is one method: record(data, opts) -> RecordingResult.
 * All 13 steps, mutex, kernel, executor, traceId generation, and the
 * retry/preview modes are hidden behind the seam.
 *
 * Deletion test: deleting this module forces 13 step registrations + mutex +
 * kernel to reappear in every caller. Deleting a shallow factory only moves one line.
 */

import { addLog, LogType } from '../../utils/logger.js';
import { pickDefined } from '../../utils/objectUtils.js';
import { ErrorStrategy, type RecordingContext, type PipelineError, type PipelineStep, type StepDeps, type UrlStore } from './types.js';
import { notifyObsidianSaveSuccess, buildErrorResult, buildPrivatePageResult, notifyRecordingError, buildResult } from './resultBuilder.js';
import { PrivatePageError, DuplicateError } from './steps/index.js';
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
}

/**
 * @internal — Prefer distinct entry points `record()` / `preview()` / `retryObsidianWrite()`.
 * Kept only for backward compat with `record(data, { mode })`. New code must not import this.
 */
export type RecordMode = 'normal' | 'preview' | 'retryObsidian';

export interface RecordOptions {
  /** @deprecated — use distinct entry points `preview()` / `retryObsidianWrite()` instead */
  mode?: RecordMode;
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

  constructor(deps: RecordingOrchestratorDeps) {
    this.getPrivacyInfoWithCache = deps.getPrivacyInfoWithCache;
    this.getSettingsWithCache = deps.getSettingsWithCache;
    this.obsidian = deps.obsidian;
    this.aiService = deps.aiService;
    this.sqliteClient = deps.sqliteClient;
    this.urlStore = deps.urlStore;
    this.mutexMap = deps.perUrlMutexMap ?? new PerUrlMutexMap();
    this.executor = new StepExecutor(deps.offlineNetworkQueue ?? null);

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
   * @deprecated — Prefer distinct entry points:
   * - `record()` for normal full pipeline (13 steps)
   * - `preview()` for previewBreakpoint short-circuit
   * - `retryObsidianWrite(job)` for 2-step retry (no AI re-run)
   * This wrapper is kept for backward compat and delegates to the compiled subsets.
   * The `mode` branching is the only place `RecordMode` is read; no inline
   * `formatMarkdownStep + saveToObsidianStep` exists here (see `retrySteps`).
   */
  async record(data: RecordingData, opts: RecordOptions = {}): Promise<RecordingResult> {
    const mode: RecordMode = opts.mode ?? (opts.previewOnly || (data as { previewOnly?: boolean }).previewOnly ? 'preview' : 'normal');
    if (mode === 'retryObsidian') return this.retryObsidian(data, opts);
    if (mode === 'preview') return this.preview(data, opts);
    return this.recordFull(data, opts);
  }

  /** Normal path: full 13 steps */
  async recordFull(data: RecordingData, opts: RecordOptions = {}): Promise<RecordingResult> {
    const settings = opts.settings ?? await this.getSettingsWithCache();
    return this.mutexMap.runExclusive(data.url, () => this.executeInternal(data, settings));
  }

  /** Preview path: short-circuit after privacyPipeline (previewBreakpoint) */
  async preview(data: RecordingData, opts: RecordOptions = {}): Promise<RecordingResult> {
    const settings = opts.settings ?? await this.getSettingsWithCache();
    const effectiveData = { ...data, previewOnly: true } as RecordingData;
    return this.mutexMap.runExclusive(effectiveData.url, () => this.executeInternal(effectiveData, settings));
  }

  /** Retry Obsidian path: 2-step subset compiled at construction (no inline) */
  private async retryObsidian(data: RecordingData, opts: RecordOptions = {}): Promise<RecordingResult> {
    return this.mutexMap.runExclusive(data.url, async () => {
      const settings = opts.settings ?? await this.getSettingsWithCache();
      const job = {
        title: (data as unknown as { title: string }).title ?? '',
        url: data.url,
        summary: (data as unknown as { summary: string }).summary ?? '',
        tags: (data as unknown as { tags?: string[] }).tags,
      };
      const traceId = this.generateTraceId();
      // Typed builder replaces `...pickDefined({ tags })` spread — tags handling is explicit
      const context = createRetryContext(job, settings, traceId);
      const deps = createStepDeps({
        obsidian: this.obsidian,
        aiService: this.aiService,
        urlStore: this.urlStore,
        sqliteClient: this.sqliteClient,
      });
      const retryResult = await this.executeRetrySubset(context, deps, traceId);
      if ((retryResult as unknown as RecordingContext).obsidianDuration != null) notifyObsidianSaveSuccess(job.title || data.url);
      return { success: true } as unknown as RecordingResult;
    });
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
      if ((retryResult as unknown as RecordingContext).obsidianDuration != null) notifyObsidianSaveSuccess(job.title || job.url);
      return true;
    });
  }

  /**
   * Backward-compat alias for offline queue. Delegates to `retryObsidianWrite`.
   * @deprecated — use `retryObsidianWrite(job)` directly
   */
  async retryObsidianWriteOnly(job: { title: string; url: string; summary: string; tags?: string[] }): Promise<boolean> {
    return this.retryObsidianWrite(job);
  }

  /**
   * Sole state owner of pipeline execution — formerly PipelineKernel (20-line
   * thin loop). Inlined here so recording semantics (PrivatePage/Duplicate
   * special cases, FATAL/RETRY error mapping, previewBreakpoint) live next to
   * the step definitions that declare them.
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
        if (error instanceof PrivatePageError) return buildPrivatePageResult(context, error);
        if (error instanceof DuplicateError) return { success: true, skipped: true, reason: error.reason, title: data.title, url: data.url };
        if (step.errorStrategy === ErrorStrategy.FATAL || step.errorStrategy === ErrorStrategy.RETRY) {
          const errorResult = buildErrorResult(context, error as Error, step.name);
          notifyRecordingError(context.data.title, (error as Error).message);
          return errorResult;
        }
        const pipelineError: PipelineError = {
          step: step.name, error: error as Error, strategy: step.errorStrategy, timestamp: Date.now(),
          ...pickDefined({ recoveryKind: step.offlineRetry?.jobKind }),
          context: { url: context.data.url, tabId: undefined }
        };
        context.errors.push(pipelineError);
        addLog(LogType.WARN, `Pipeline step ${step.name} failed with ${step.errorStrategy} strategy`, { error: (error as Error).message, url: data.url, traceId: context.traceId });
      }
    }

    const result = buildResult(context);
    if (result.success && result.obsidianDuration != null) notifyObsidianSaveSuccess(data.title);
    return result;
  }
}

export function createRecordingOrchestrator(deps: RecordingOrchestratorDeps): RecordingOrchestrator {
  return new RecordingOrchestrator(deps);
}
