/**
 * Pipeline types for recordingLogic refactoring
 * Phase 1: Pipeline pattern implementation
 */

import type { RecordingData, RecordingResult } from '../../messaging/types.js';
import type { Settings } from '../../utils/storage.js';
import type { PrivacyPipelineResult } from '../privacyPipeline.js';
import type { AIService } from '../ai/AIService.js';
import type { MarkdownTemplateEntryData } from '../../utils/types.js';

// Constants
export const MAX_RECORD_SIZE = 64 * 1024; // 64KB

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

/**
 * Recording context passed through pipeline steps
 * Contains input, intermediate results, and output
 */
export interface RecordingContext {
  // Input data
  data: RecordingData;
  settings: Settings;
  force: boolean;
  aiService?: AIService | null;

  // Trace / correlation ID for cross-step logging
  traceId?: string;

  // Intermediate results (cached for performance)
  truncatedContent?: string;
  isDomainAllowed?: boolean;
  permissionCheck?: PermissionCheckResult;
  trustCheck?: TrustCheckResult;
  privacyResult?: PrivacyPipelineResult;
  sanitizedSummary?: string;
  markdown?: string;
  markdownEntryData?: MarkdownTemplateEntryData;

  // L0 Extractive Compression (Phase 1)
  extractedSentences?: string[];  // Extracted important sentences (L0)
  extractedSentencesBytes?: number;  // Byte count of extracted sentences
  extractedSentencesOriginalBytes?: number;  // Byte count before extraction (source text)
  extractionDuration?: number;  // Time taken for extraction (ms)

  // Timings
  aiDuration?: number;
  obsidianDuration?: number;
  localMarkdownDuration?: number;

  // Output
  result?: RecordingResult;
  errors: PipelineError[];
}

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
  /** Execute the step */
  execute(context: RecordingContext): Promise<RecordingContext>;
}

/**
 * Pipeline step function type
 */
export type PipelineStepFunction = (context: RecordingContext) => Promise<RecordingContext>;
