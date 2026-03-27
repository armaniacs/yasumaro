/**
 * Pipeline types for recordingLogic refactoring
 * Phase 1: Pipeline pattern implementation
 */

import type { RecordingData, RecordingResult } from '../../messaging/types.js';
import type { Settings } from '../../utils/storage.js';
import type { PrivacyPipelineResult } from '../privacyPipeline.js';
import type { AIClient } from '../aiClient.js';

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
  aiClient?: AIClient | null;

  // Intermediate results (cached for performance)
  truncatedContent?: string;
  isDomainAllowed?: boolean;
  permissionCheck?: PermissionCheckResult;
  trustCheck?: TrustCheckResult;
  privacyResult?: PrivacyPipelineResult;
  sanitizedSummary?: string;
  markdown?: string;

  // Timings
  aiDuration?: number;

  // Output
  result?: RecordingResult;
  errors: PipelineError[];
}

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
  /** Execute the step */
  execute(context: RecordingContext): Promise<RecordingContext>;
}

/**
 * Pipeline step function type
 */
export type PipelineStepFunction = (context: RecordingContext) => Promise<RecordingContext>;

/**
 * Recording pipeline configuration
 */
export interface PipelineConfig {
  /** Steps to execute in order */
  steps: PipelineStep[];
  /** Global timeout for entire pipeline (ms) */
  timeout?: number;
}
