/**
 * Pipeline types for RecordingPipeline.
 *
 * RecordingContext is decomposed into logical sub-types. Each pipeline step
 * declares which sub-types it reads/writes via JSDoc. The full context is
 * a composition of all sub-types, used only by the pipeline orchestrator.
 */

import type { RecordingData, RecordingResult, MaskedItem } from '../../messaging/types.js';
import type { Settings } from '../../utils/storage/types.js';
import type { PrivacyPipelineResult } from '../privacyPipeline.js';
import type { AIService } from '../ai/AIService.js';
import type { MarkdownTemplateEntryData } from '../../utils/types.js';
import type { ObsidianClient } from '../obsidianClient.js';

/**
 * Error handling strategies for pipeline steps
 * @internal — internal seam for step orchestration. External callers should not depend on this.
 */
export enum ErrorStrategy {
  /** Fatal error - stop pipeline and return error */
  FATAL = 'fatal',
  /** Retryable error - exponential backoff retry */
  RETRY = 'retry',
  /** Silent error - log and continue */
  SILENT = 'silent',
  /** Best effort - try alternative and continue */
  BEST_EFFORT = 'best_effort'
}

/**
 * Pipeline error information
 */
export interface PipelineError {
  step: string;
  error: Error;
  strategy: ErrorStrategy;
  timestamp: number;
  recoveryKind?: OfflineJobKind;
  /**
   * Offline-enqueue result carried explicitly (PBI 2026-10-16-04): true when
   * StepExecutor durably queued the job, making the offline job the sole
   * recovery owner. Read by finalizeSuccess instead of the former dynamic
   * Error attachment.
   */
  offlineEnqueued?: boolean;
  context?: {
    url: string;
    tabId?: number | undefined;
  };
}

/**
 * Sole recovery owner for a failed recording (PBI 2026-10-16-04).
 * Exactly one owner exists so the 5-minute alarm retry and a manual re-run
 * can never recover the same recording twice — or zero times.
 */
export type RecoveryOwner = 'offline' | 'pending' | 'none';

/**
 * Regenerate records (`targetEntryId` set) are UPDATE-only: the pending and
 * offline replays both act as INSERTs by URL, which would duplicate the row
 * being replaced. The `!== undefined` check lives here alone — every owner
 * decision goes through {@link decideRecoveryOwner}.
 */
export function isRegenerateRecord(data: { targetEntryId?: unknown }): boolean {
  return data.targetEntryId !== undefined;
}

/**
 * Single pure owner decision. Truth table:
 * - regenerate (targetEntryId set) → 'none' (UPDATE-only, no recovery queue)
 * - enqueued → 'offline' (the queued job is the sole owner)
 * - otherwise → 'pending' (the pending page is the sole owner)
 */
export function decideRecoveryOwner(input: {
  targetEntryId?: number | undefined;
  enqueued: boolean;
}): RecoveryOwner {
  if (isRegenerateRecord(input)) {
    return 'none';
  }
  return input.enqueued ? 'offline' : 'pending';
}

/**
 * Typed failure carrier replacing the former dynamic `offlineEnqueue`
 * property attachment on Error (PBI 2026-10-16-04).
 *
 * StepExecutor throws this instead of mutating the original error, so the
 * outcome policy reads the enqueue result from a declared field. Orchestrator
 * and SavePhase forward the thrown value opaquely and need no change.
 * `message` mirrors the original so `toThrow(message)` assertions keep
 * passing; the original carrier is available as `causeError`.
 */
export class StepFailureError extends Error {
  readonly causeError: unknown;
  readonly enqueued: boolean;

  constructor(cause: unknown, enqueued: boolean) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'StepFailureError';
    this.causeError = cause;
    this.enqueued = enqueued;
  }
}

/**
 * Splits a step failure into the original error and its enqueue result.
 * Raw (unwrapped) errors never reached the enqueue gate, so `enqueued` is
 * false — matching the former `readOfflineEnqueueInfo(...)?.enqueued === true`
 * check when no info was attached.
 */
export function unwrapStepFailure(thrown: unknown): { error: unknown; enqueued: boolean } {
  if (thrown instanceof StepFailureError) {
    return { error: thrown.causeError, enqueued: thrown.enqueued };
  }
  return { error: thrown, enqueued: false };
}

/**
 * Permission check result
 */
export interface PermissionCheckResult {
  permitted: boolean;
  domain: string;
  error?: string;
}

/**
 * Trust check result
 */
export interface TrustCheckResult {
  canProceed: boolean;
  showAlert: boolean;
  reason?: string;
  trustLevel: string;
}

// ============================================================================
// Pipeline sub-types — each represents a logical group of context fields
// ============================================================================

/**
 * Pipeline input: immutable throughout the pipeline.
 * Constructed once by the orchestrator, never mutated by steps.
 *
 * Used by: all steps (via data, settings, force, traceId)
 */
export interface PipelineInput {
  data: RecordingData;
  settings: Settings;
  force: boolean;
  aiService?: AIService | null;
  traceId?: string;
  /**
   * Replay write marker set only by `createRetryContext` (the offline
   * Obsidian-write retry). The saveObsidian sink reads it to pass
   * `dedupe: true` to the Obsidian client, so a retried operation cannot
   * stack a second copy of identical section content. Normal recordings and
   * user-invoked appends never set it — their insertion stays unconditional.
   */
  replayWrite?: boolean;
}

/**
 * Check results: produced by domain/permission/trust/duplicate check steps.
 *
 * Produced by: truncateContentStep, checkDomainFilterStep, checkPermissionStep, checkTrustDomainStep
 * Read by: extractSentencesStep (truncatedContent)
 */
export interface CheckResults {
  truncatedContent?: string;
  isDomainAllowed?: boolean;
  permissionCheck?: PermissionCheckResult;
  trustCheck?: TrustCheckResult;
}

/**
 * Privacy results: produced by AI summarization and PII masking.
 *
 * Produced by: processPrivacyPipelineStep
 * Read by: extractSentencesStep, formatMarkdownStep, saveMetadataStep
 */
export interface PrivacyResults {
  privacyResult?: PrivacyPipelineResult;
  sanitizedSummary?: string;
}

/**
 * Content extraction results: produced by L0 extractive compression.
 *
 * Produced by: extractSentencesStep
 * Read by: formatMarkdownStep, saveMetadataStep
 */
export interface ContentResults {
  extractedSentences?: string[];
  extractedSentencesBytes?: number;
  extractedSentencesOriginalBytes?: number;
  extractionDuration?: number;
}

/**
 * Format results: produced by markdown formatting.
 *
 * Produced by: formatMarkdownStep
 * Read by: saveToObsidianStep, saveLocalMarkdownStep
 */
export interface FormatResults {
  markdown?: string;
  markdownEntryData?: MarkdownTemplateEntryData;
}

/**
 * Pipeline timings: accumulated across steps.
 *
 * Produced by: processPrivacyPipelineStep (aiDuration), saveToObsidianStep (obsidianDuration), saveLocalMarkdownStep (localMarkdownDuration)
 * Read by: saveMetadataStep
 */
export interface PipelineTimings {
  aiDuration?: number;
  obsidianDuration?: number;
  localMarkdownDuration?: number;
}

/**
 * Pipeline内部で組み立て中の RecordingResult。
 *
 * maskedItems は生 MaskedItem（original 付き）を許容する。
 * 外部へ送出する直前に必ず `piiBoundary.toExternalResult()` を通し、
 * StrippedMaskedItem へ変換すること。
 */
export type InProgressRecordingResult = Omit<RecordingResult, 'maskedItems'> & {
  maskedItems?: (string | MaskedItem)[];
};

/**
 * Pipeline output: final result and errors.
 *
 * Produced by: processPrivacyPipelineStep (result for preview), pipeline orchestrator (result for success/error)
 * Read by: pipeline orchestrator (buildResult, buildErrorResult)
 */
export interface PipelineOutput {
  result?: InProgressRecordingResult;
  errors: PipelineError[];
}

/**
 * Full recording context: 7-way intersection.
 *
 * Constructed via `contextBuilder.ts` helpers (`createRetryContext()` /
 * `createStepDeps()`). Step ordering (e.g. `markdown` only after
 * formatMarkdownStep) is enforced at runtime by the orchestrator's step
 * sequence; the earlier stage-branding experiment was removed because the
 * step seam never consumed the brands.
 *
 * @internal — internal seam, not part of public interface. Only RecordingOrchestrator constructs and passes this.
 */
export type RecordingContext = PipelineInput & CheckResults & PrivacyResults & ContentResults & FormatResults & PipelineTimings & PipelineOutput;

/**
 * Job type for the offline retry queue.
 * Determines which retry handler processes the job when connectivity returns.
 */
export type OfflineJobKind = 'ai_summary' | 'obsidian_sync';

/**
 * Pipeline step interface
 * @internal — internal seam, not part of RecordingPipeline's public interface. External callers should use `record()` only.
 */
export interface PipelineStep {
  /** Step name for logging and debugging */
  name: string;
  /** Error handling strategy */
  errorStrategy: ErrorStrategy;
  /** Maximum retry attempts (for RETRY strategy) */
  maxRetries?: number;
  /**
   * When present, the step is eligible for offline retry.
   * The `jobKind` routes the retry to the correct handler
   * (AI summarization vs Obsidian sync).
   *
   * Presence/absence acts as the enabled flag — no separate boolean needed.
   * This replaces the former string-comparison-based dispatch in enqueueOfflineJob.
   */
  offlineRetry?: { jobKind: OfflineJobKind };
  previewBreakpoint?: boolean;
  /** Execute the step with optional injected dependencies */
  execute(context: RecordingContext, deps?: StepDeps): Promise<RecordingContext>;
}

/**
 * Pipeline step function type.
 * Steps that need external dependencies receive them via the deps parameter
 * instead of creating them internally or accessing them through context.
 */
export type PipelineStepFunction = (context: RecordingContext, deps?: StepDeps) => Promise<RecordingContext>;

/**
 * Minimal URL store interface checkDuplicateStep depends on. Backed by
 * chrome.storage.local (getSavedUrlsWithTimestamps) in production; tests
 * inject an in-memory implementation to avoid mocking chrome.storage.
 */
export interface UrlStore {
  getSavedUrlsWithTimestamps(): Promise<Map<string, number>>;
}

/**
 * Dependencies injected into pipeline steps.
 * Steps receive this as a second argument instead of creating dependencies
 * internally or accessing them through context.
 *
 * This makes step dependencies explicit and testable.
 */
export interface StepDeps {
  /** Obsidian client for daily note operations */
  obsidian: ObsidianClient;
  /** AI service for summarization */
  aiService: AIService;
  /** URL store for duplicate-detection lookups (checkDuplicateStep) */
  urlStore?: UrlStore;
  /** SQLite client for persistence (saveSqliteStep) */
  sqliteClient?: import('../sqlite/offscreenGateway.js').SqliteClient | null;
}
