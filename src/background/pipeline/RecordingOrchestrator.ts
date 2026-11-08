/**
 * RecordingOrchestrator — deep module hiding 13 steps + PerUrlMutex + PipelineKernel
 *
 * Interface is three entry points:
 * - record(data, opts) -> RecordingResult (full 13 steps)
 * - preview(data, opts) -> RecordingResult (previewBreakpoint short-circuit)
 * - retryObsidianWrite(job) -> boolean (SavePhase.saveRetry subset, no AI re-run)
 *
 * Deletion test: deleting this module forces 13 step registrations + mutex +
 * kernel to reappear in every caller. Deleting a shallow factory only moves one line.
 */

import { generateId } from '../../utils/generateId.js';
import { flushLogs } from '../../utils/logger/core.js';
import { ErrorStrategy, type RecordingContext, type PipelineStep, type StepDeps, type UrlStore } from './types.js';
import { defaultOutcomeAdapters, finalizeSuccess, handleStepFailure, type OutcomeAdapters } from './recordingOutcome.js';
import { toExternalResult } from './piiBoundary.js';
import { createRetryContext, createStepDeps } from './contextBuilder.js';
import {
  truncateContentStep, checkDomainFilterStep, checkPermissionStep, checkTrustDomainStep,
  PrivacyHeadersChecker, checkDuplicateStep,
  applyAutoTagRulesStep,
  extractSentencesStep, formatMarkdownStep
} from './steps/index.js';
import {
  createProcessPrivacyPipelineStep,
  defaultPrivacyPipelineFactory,
  type PrivacyPipelineFactory,
} from './steps/processPrivacyPipelineStep.js';
import { createSavePhase, type SavePhase } from './savePhase.js';
import type { RecordingData, RecordingResult } from '../../messaging/types.js';
import type { Settings } from '../../utils/storage/types.js';
import type { ObsidianClient } from '../obsidianClient.js';
import type { AIService } from '../ai/AIService.js';
import type { SqliteClient } from '../sqlite/offscreenGateway.js';
import type { PrivacyInfo } from '../../utils/privacyChecker.js';
import type { OfflineNetworkQueue } from '../offlineNetworkQueue.js';
import { PerUrlMutexMap } from './perUrlMutex.js';
import { StepExecutor, type StepDelayFn } from './stepExecutor.js';
import { RECORDING_GATE_TABLE, type RecordingGate } from '../../utils/recordingGateTable.js';
import { claimRecoveryOwner, releaseRecoveryOwner, type RecoveryClaimStore } from '../../utils/recoveryClaimStore.js';
import { getPendingPages, type PendingPage } from '../../utils/pendingStorage.js';

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
  privacyPipelineFactory?: PrivacyPipelineFactory;
  /** Retry backoff clock; defaults to the real timer. */
  stepDelay?: StepDelayFn;
  /**
   * PBI 2026-11-07-19: recovery-claim seam. Defaults to the durable claim
   * store plus the pending-pages reader; tests inject fakes instead of
   * touching chrome.storage.
   */
  recoveryClaim?: RecoveryClaimDeps;
}

/**
 * PBI 2026-11-07-19: the injectable half of the claim-owning record entry.
 * The store keeps its TTL/CAS semantics (call it, don't redesign it); the
 * reader decides whether a URL is a recovery run.
 */
export interface RecoveryClaimDeps {
  claimStore: Pick<RecoveryClaimStore, 'claimRecoveryOwner' | 'releaseRecoveryOwner'>;
  getPendingPages: () => Promise<PendingPage[]>;
}

export interface RecordOptions {
  /**
   * Explicit settings, bypassing getSettingsWithCache. Used by the
   * manual/preview record handlers which have already resolved settings and
   * must not race a concurrent cache refresh.
   */
  settings?: Settings;
  /**
   * PBI 2026-11-07-19: set by the manual/preview surface only. The
   * orchestrator then owns the recovery-claim order (pending-check →
   * claim → run → finally-release) inside `record()`, so callers build the
   * request and cannot mis-order acquire/release. Absent/false keeps the
   * claim-free path byte-identical for save / valid-visit / regenerate /
   * notification-confirm / offline-retry, which keep their existing envelopes.
   */
  acquireRecoveryClaim?: boolean;
}

/**
 * Build the pre-save order in one place: truncate, then the NN04 gate table
 * rows in canonical table order, then the AI shaping steps. The gate table
 * owns the gate ORDER (ADR 2026-09-28-recording-gate-order-canonical); this
 * list only carries each step's errorStrategy / maxRetries / offlineRetry
 * execution metadata. Reordering the table reorders execution.
 */
function buildPreSaveSteps(init: {
  privacyHeaders: PipelineStep['execute'];
  privacyPipelineFactory: PrivacyPipelineFactory;
}): PipelineStep[] {
  const gateExecutors: Record<RecordingGate, PipelineStep['execute']> = {
    domainFilter: checkDomainFilterStep,
    permission: checkPermissionStep,
    trust: checkTrustDomainStep,
    privacyHeaders: init.privacyHeaders,
    duplicate: checkDuplicateStep,
  };
  const gateSteps: PipelineStep[] = RECORDING_GATE_TABLE.map((row) => ({
    name: row.name,
    errorStrategy: ErrorStrategy.FATAL,
    execute: gateExecutors[row.name],
  }));
  return [
    { name: 'truncate', errorStrategy: ErrorStrategy.FATAL, execute: truncateContentStep },
    ...gateSteps,
    { name: 'privacyPipeline', errorStrategy: ErrorStrategy.RETRY, maxRetries: 3, offlineRetry: { jobKind: 'ai_summary' }, previewBreakpoint: true, execute: createProcessPrivacyPipelineStep(init.privacyPipelineFactory) },
    // PBI 2026-10-23-06: rule tags merge after the AI tags (FATAL is safe —
    // the step catches everything internally and returns context untouched).
    { name: 'applyAutoTagRules', errorStrategy: ErrorStrategy.FATAL, execute: applyAutoTagRulesStep },
    { name: 'extractSentences', errorStrategy: ErrorStrategy.RETRY, maxRetries: 3, offlineRetry: { jobKind: 'ai_summary' }, execute: extractSentencesStep },
    { name: 'formatMarkdown', errorStrategy: ErrorStrategy.FATAL, execute: formatMarkdownStep },
  ];
}
export class RecordingOrchestrator {
  private steps: PipelineStep[];
  private preSaveSteps: PipelineStep[];
  private getPrivacyInfoWithCache: (url: string) => Promise<PrivacyInfo | null>;
  private getSettingsWithCache: () => Promise<Settings>;
  private obsidian: ObsidianClient;
  private aiService: AIService | null;
  private sqliteClient: SqliteClient | null;
  private urlStore: UrlStore | undefined;
  private mutexMap: PerUrlMutexMap;
  private executor: StepExecutor;
  private outcomeAdapters: OutcomeAdapters;
  private savePhase: SavePhase;
  /**
   * Null unless injected: the production claim store / pending reader are
   * resolved lazily on the flag path only, so claim-free construction never
   * touches those modules (existing partial-mock suites keep working).
   */
  private readonly recoveryClaim: RecoveryClaimDeps | null;

  constructor(deps: RecordingOrchestratorDeps) {
    this.getPrivacyInfoWithCache = deps.getPrivacyInfoWithCache;
    this.getSettingsWithCache = deps.getSettingsWithCache;
    this.obsidian = deps.obsidian;
    this.aiService = deps.aiService;
    this.sqliteClient = deps.sqliteClient;
    this.urlStore = deps.urlStore;
    this.mutexMap = deps.perUrlMutexMap ?? new PerUrlMutexMap();
    this.executor = new StepExecutor(deps.offlineNetworkQueue ?? null, undefined, deps.stepDelay);
    this.outcomeAdapters = deps.outcomeAdapters ?? defaultOutcomeAdapters;
    this.savePhase = createSavePhase({ executor: this.executor, outcomeAdapters: this.outcomeAdapters });
    this.recoveryClaim = deps.recoveryClaim ?? null;

    // Pre-save order lives in buildPreSaveSteps; the gate rows still derive
    // from RECORDING_GATE_TABLE order (NN04 shape unchanged).
    this.preSaveSteps = buildPreSaveSteps({
      privacyHeaders: this.createPrivacyHeadersStep(),
      privacyPipelineFactory: deps.privacyPipelineFactory ?? defaultPrivacyPipelineFactory,
    });

    // Full 13-step introspection surface (SavePhase owns the tail rows,
    // including the retry-subset projection the retry entry point uses).
    this.steps = [...this.preSaveSteps, ...this.savePhase.steps()];
  }

  private createPrivacyHeadersStep() {
    const checker = new PrivacyHeadersChecker(this.getPrivacyInfoWithCache);
    return (context: RecordingContext, _deps?: StepDeps) => checker.execute(context);
  }

  /**
   * Normal path: full 13 steps. Preview requests must use `preview()` —
   * the `previewOnly` data flag short-circuits at the previewBreakpoint step.
   *
   * PBI 2026-11-07-19: with `opts.acquireRecoveryClaim` (manual/preview
   * surface only) the claim envelope below owns the order, wrapping the
   * preview delegation too — the same envelope the handler used to hold.
   */
  async record(data: RecordingData, opts: RecordOptions = {}): Promise<RecordingResult> {
    if (opts.acquireRecoveryClaim === true) {
      // Cleared before delegating so the inner record() cannot re-enter
      // this envelope.
      return this.recordWithRecoveryClaim(data, { ...opts, acquireRecoveryClaim: false });
    }
    if (data.previewOnly) return this.preview(data, opts);
    // PBI 2026-11-08-07(1): settings must be read AFTER the per-URL mutex is
    // acquired, not before waiting on it. A recording queued behind another
    // run of the same URL would otherwise execute with a pre-wait snapshot —
    // e.g. a consent granted at intake but withdrawn mid-wait would still be
    // recorded. An explicitly passed `settings` stays caller-owned (the
    // manual/preview surface resolved it and must not race a cache refresh).
    if (opts.settings !== undefined) {
      const settings = opts.settings;
      return this.mutexMap.runExclusive(data.url, () => this.executeInternal(data, settings));
    }
    return this.mutexMap.runExclusive(data.url, async () => {
      const freshSettings = await this.getSettingsWithCache();
      return this.executeInternal(data, freshSettings);
    });
  }

  /**
   * PBI 2026-11-07-19: the sole claim-owning record entry. A MANUAL_RECORD
   * for a URL that sits in the pending pages is a manual recovery run — the
   * same durable claim the offline queue processor holds, so it cannot
   * overlap the automatic retry or another surface's re-run of the same
   * recording. Non-recovery URLs fall through to the claim-free path, and a
   * lost claim race returns the same RECOVERY_CLAIMED shape the handler
   * used to send. The flag is cleared before delegating so the inner
   * `record()` cannot re-enter this envelope.
   */
  private async recordWithRecoveryClaim(data: RecordingData, opts: RecordOptions): Promise<RecordingResult> {
    const claimDeps = this.recoveryClaim ?? {
      claimStore: { claimRecoveryOwner, releaseRecoveryOwner },
      getPendingPages,
    };
    // PBI 2026-11-08-07(2): a failed pending-pages read must not collapse to
    // "no pending pages". Treating a storage outage as a non-recovery run
    // lets this run overlap the automatic retry of the same recording
    // (duplicate Obsidian writes). The failure propagates to the caller as a
    // detectable error instead of silently running claim-free.
    const pendingPages = await claimDeps.getPendingPages();
    const isRecoveryRun = pendingPages.some((p) => p.url === data.url);
    if (!isRecoveryRun) return this.record(data, opts);
    if (!(await claimDeps.claimStore.claimRecoveryOwner(data.url, 'manual'))) {
      return { success: false, error: 'RECOVERY_CLAIMED' };
    }
    try {
      return await this.record(data, opts);
    } finally {
      await claimDeps.claimStore.releaseRecoveryOwner(data.url, 'manual');
    }
  }

  /** Preview path: short-circuit after privacyPipeline (previewBreakpoint) */
  async preview(data: RecordingData, opts: RecordOptions = {}): Promise<RecordingResult> {
    const effectiveData = { ...data, previewOnly: true };
    // Same post-wait freshness as record(): preview shares the per-URL mutex
    // and must not render under a pre-wait consent snapshot either.
    if (opts.settings !== undefined) {
      const settings = opts.settings;
      return this.mutexMap.runExclusive(effectiveData.url, () => this.executeInternal(effectiveData, settings));
    }
    return this.mutexMap.runExclusive(effectiveData.url, async () => {
      const freshSettings = await this.getSettingsWithCache();
      return this.executeInternal(effectiveData, freshSettings);
    });
  }

  /**
   * Distinct entry point: retry Obsidian write only (no AI re-run).
   * Runs the retry subset through the SavePhase seam (`saveRetry`) and
   * decides success from the SaveReceipt outcomes — the same receipt shape
   * the normal path uses. The 3 retry-write flags travel in the RetryContext
   * bundle built by `createRetryContext`; this method reads no flag itself.
   * Step failures propagate to the caller (the offline queue keeps the job),
   * matching the former hand loop.
   */
  async retryObsidianWrite(job: { title: string; url: string; summary: string; markdown?: string | undefined; tags?: string[] }): Promise<boolean> {
    return this.mutexMap.runExclusive(job.url, async () => {
      try {
        return await this.retryObsidianWriteInner(job);
      } finally {
        // Same durability contract as executeInternal below.
        await flushLogs();
      }
    });
  }

  private async retryObsidianWriteInner(job: { title: string; url: string; summary: string; markdown?: string | undefined; tags?: string[] }): Promise<boolean> {
    const settings = await this.getSettingsWithCache();
    const traceId = generateId();
    const context = createRetryContext(job, settings, traceId);
    const deps = createStepDeps({
      obsidian: this.obsidian,
      aiService: this.aiService,
      urlStore: this.urlStore,
      sqliteClient: this.sqliteClient,
    });
    const receipt = await this.savePhase.saveRetry(context, deps);
    if (receipt.terminated) return false;
    if (receipt.outcomes.find((o) => o.name === 'saveObsidian')?.status !== 'ok') return false;
    this.outcomeAdapters.notifier.notifySaveSuccess(job.title || job.url);
    return true;
  }

  /**
   * Single order seam: the full intake-to-save-tail step order in one query.
   * Callers learn only record / preview / retryObsidianWrite — order knowledge
   * lives here, derived from the pre-save order above and the SavePhase tail.
   * The gate subsequence keeps the NN04 table-driven shape; adding a sink is
   * one SAVE_FAN_OUT row and this order follows without caller edits.
   */
  flowOrder(): string[] {
    return [
      ...this.preSaveSteps.map((step) => step.name),
      ...this.savePhase.steps().map((step) => step.name),
    ];
  }

  /**
   * Sole state owner of pipeline execution — formerly PipelineKernel (20-line
   * thin loop). Owns the step loop and BEST_EFFORT continuation; the outcome
   * policy (PrivatePage/Duplicate special cases, FATAL/RETRY mapping, pending
   * recovery, notices) lives in `recordingOutcome` and is driven through
   * injected adapters.
   */
  private async executeInternal(data: RecordingData, settings: Settings): Promise<RecordingResult> {
    try {
      return await this.executeInternalInner(data, settings);
    } finally {
      // Durability (logCritical precedent: flush so entries are not lost on
      // SW termination): a recording's traceId logs must be queryable right
      // after it completes, not only once the buffer hits BATCH_FLUSH_SIZE
      // or the 1-minute alarm fires. flushLogs is a no-op when empty and
      // persistPending already swallows its own errors, so completion paths
      // cannot break here.
      await flushLogs();
    }
  }

  private async executeInternalInner(data: RecordingData, settings: Settings): Promise<RecordingResult> {
    const traceId = generateId();
    const deps = createStepDeps({
      obsidian: this.obsidian,
      aiService: this.aiService,
      urlStore: this.urlStore,
      sqliteClient: this.sqliteClient,
      // PBI 2026-10-22-05: the webhook save-tail sink reads the real
      // privacy-headers verdict from the same cache the privacyHeaders gate
      // step uses — one verdict source, no second judgment.
      privacyReader: this.getPrivacyInfoWithCache,
    });
    let context: RecordingContext = { data, settings, force: data.force || false, aiService: deps.aiService, traceId, errors: [] };

    for (const step of this.preSaveSteps) {
      try {
        context = await this.executor.executeWithStrategy(step, context, deps);
        if (data.previewOnly && context.result && step.previewBreakpoint) return toExternalResult(context.result);
      } catch (error) {
        // Outcome policy owns the error taxonomy + pending + notice.
        // BEST_EFFORT returns { done: false } so the loop continues.
        const failure = handleStepFailure(error, step, context, this.outcomeAdapters);
        if (failure.done) return failure.result;
      }
    }

    // Save tail runs through the SavePhase seam (ordering + BEST_EFFORT
    // continuation owned there). Preview never reaches it: the breakpoint
    // above returns before the first save sink.
    const receipt = await this.savePhase.save(context, deps);
    if (receipt.terminated) return receipt.result;

    return finalizeSuccess(receipt.context, this.outcomeAdapters);
  }
}

export function createRecordingOrchestrator(deps: RecordingOrchestratorDeps): RecordingOrchestrator {
  return new RecordingOrchestrator(deps);
}
