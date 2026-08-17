/**
 * Pipeline types for RecordingPipeline.
 *
 * RecordingContext is decomposed into logical sub-types. Each pipeline step
 * declares which sub-types it reads/writes via JSDoc. The full context is
 * a composition of all sub-types, used only by the pipeline orchestrator.
 */

import type { RecordingData, RecordingResult } from '../../messaging/types.js';
import type { Settings } from '../../utils/storage.js';
import type { PrivacyPipelineResult } from '../privacyPipeline.js';
import type { AIService } from '../ai/AIService.js';
import type { MarkdownTemplateEntryData } from '../../utils/types.js';
import type { ObsidianClient } from '../obsidianClient.js';

// Re-export MAX_RECORD_SIZE from the canonical source (recordingValidator.ts)
export { MAX_RECORD_SIZE } from '../recordingValidator.js';

/**
 * Error handling strategies for pipeline steps
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
  context?: {
    url: string;
    tabId?: number;
  };
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
 * Pipeline output: final result and errors.
 *
 * Produced by: processPrivacyPipelineStep (result for preview), pipeline orchestrator (result for success/error)
 * Read by: pipeline orchestrator (buildResult, buildErrorResult)
 */
export interface PipelineOutput {
  result?: RecordingResult;
  errors: PipelineError[];
}

/**
 * Full recording context: composition of all sub-types.
 * Used by the pipeline orchestrator and step function signatures.
 *
 * Steps should reference specific sub-types in their JSDoc to declare
 * which fields they read/write. The orchestrator constructs and passes
 * the full context.
 */
export type RecordingContext = PipelineInput & CheckResults & PrivacyResults & ContentResults & FormatResults & PipelineTimings & PipelineOutput;

/**
 * Job type for the offline retry queue.
 * Determines which retry handler processes the job when connectivity returns.
 */
export type OfflineJobKind = 'ai_summary' | 'obsidian_sync';

/**
 * Pipeline step interface
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
}
