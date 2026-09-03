/**
 * Typed Context builder for RecordingPipeline.
 *
 * RecordingContext is a 7-way intersection (PipelineInput & CheckResults & ...).
 * Out-of-order reads (e.g. reading `markdown` before formatMarkdownStep) were
 * previously runtime `undefined`. This module introduces explicit stage-branded
 * slices and a builder that makes the contract type-checkable.
 *
 * Full Result<> threading is intentionally deferred — the builder provides the
 * minimal seam to get a compile-time error on mis-ordered step composition
 * without rewriting all 13 steps at once.
 */

import type { RecordingData } from '../../messaging/types.js';
import type { Settings } from '../../utils/storage/types.js';
import type {
  RecordingContext,
  StepDeps,
  PipelineInput,
  PipelineOutput,
  ContextStage,
  StagedContext,
  InitialContext,
} from './types.js';
import type { PrivacyPipelineResult } from '../privacyPipeline.js';
import type { ObsidianClient } from '../obsidianClient.js';
import type { AIService } from '../ai/AIService.js';
import type { SqliteClient } from '../sqlite/offscreenGateway.js';
import type { BrowsingLogRecord } from '../../utils/sqlite-types.js';
import type { SaveSqliteStepParams } from './steps/saveSqliteStep.js';
import type { UrlStore } from './types.js';

// Re-export stage types for consumers that import only from builder
export type { ContextStage, StagedContext, InitialContext } from './types.js';

// ---------------------------------------------------------------------------
// Slice interfaces — each step declares which slice it reads/writes
// ---------------------------------------------------------------------------

/**
 * Input slice required by every step.
 */
export type InputSlice = PipelineInput & PipelineOutput;

/**
 * Privacy slice — present after processPrivacyPipelineStep.
 */
export interface PrivacySlice {
  privacyResult: PrivacyPipelineResult;
  sanitizedSummary?: string;
}

/**
 * Content slice — present after extractSentencesStep.
 */
export interface ContentSlice {
  extractedSentences: string[];
}

/**
 * Format slice — present after formatMarkdownStep.
 */
export interface FormatSlice {
  markdown: string;
}

// ---------------------------------------------------------------------------
// Retry context — explicit input for retryObsidianWrite (no AI re-run)
// ---------------------------------------------------------------------------

export interface RetryJobInput {
  title: string;
  url: string;
  summary: string;
  tags?: string[] | undefined;
}

/**
 * RetryContext is the narrow context for the 2-step retry pipeline
 * (formatMarkdown + saveToObsidian). It carries only Input + PrivacyResults
 * and is branded 'privacy' to allow formatMarkdownStep to accept it.
 */
export type RetryContext = StagedContext<'privacy'>;

export function createRetryContext(
  job: RetryJobInput,
  settings: Settings,
  traceId?: string | undefined
): RetryContext {
  // Typed builder: tags are assigned via explicit conditional, not
  // generic pickDefined spread, so the optional slice is visible in the type.
  const privacyResult: PrivacyPipelineResult = buildPrivacyResult(job.summary, job.tags);

  const base: RecordingContext = {
    data: { title: job.title, url: job.url, content: '' } as RecordingData,
    settings,
    force: true,
    errors: [],
    privacyResult,
  };

  if (traceId !== undefined) {
    (base as RecordingContext).traceId = traceId;
  }

  return base as RetryContext;
}

function buildPrivacyResult(summary: string, tags?: string[] | undefined): PrivacyPipelineResult {
  // Explicit typed conditional — not `...pickDefined({ tags })`
  if (tags !== undefined) {
    return { summary, tags } as PrivacyPipelineResult;
  }
  return { summary } as PrivacyPipelineResult;
}

// ---------------------------------------------------------------------------
// StepDeps builder — construction-time fixed, no fallback
// ---------------------------------------------------------------------------

export interface StepDepsInput {
  obsidian: ObsidianClient;
  aiService: AIService | null;
  urlStore?: UrlStore | undefined;
  sqliteClient?: SqliteClient | null | undefined;
}

/**
 * Build StepDeps with explicit optional handling.
 * Replaces `...pickDefined({ urlStore, sqliteClient }) as unknown as Pick<...>` spread.
 */
export function createStepDeps(input: StepDepsInput): StepDeps {
  const deps: StepDeps = {
    obsidian: input.obsidian,
    aiService: input.aiService as AIService,
  };

  if (input.urlStore !== undefined) {
    deps.urlStore = input.urlStore;
  }

  // sqliteClient may be null (explicitly no client) or undefined (not provided)
  if (input.sqliteClient !== undefined) {
    deps.sqliteClient = input.sqliteClient;
  }

  return deps;
}

// ---------------------------------------------------------------------------
// SaveSqlite params builder — typed alternative to pickDefined spread
// ---------------------------------------------------------------------------

export interface SaveSqliteBuilderInput {
  recordId: number;
  record: BrowsingLogRecord;
  sqliteClient: SqliteClient;
  obsidianSynced?: boolean | undefined;
  traceId?: string | undefined;
}

export function createSaveSqliteParams(input: SaveSqliteBuilderInput): SaveSqliteStepParams {
  const params: SaveSqliteStepParams = {
    recordId: input.recordId,
    record: input.record,
    sqliteClient: input.sqliteClient,
  };

  if (input.obsidianSynced !== undefined) {
    params.obsidianSynced = input.obsidianSynced;
  }

  if (input.traceId !== undefined) {
    params.traceId = input.traceId;
  }

  return params;
}

// ---------------------------------------------------------------------------
// Initial context builder — explicit typed construction for normal/preview
// ---------------------------------------------------------------------------

export function createInitialContext(
  data: RecordingData,
  settings: Settings,
  traceId: string,
  aiService?: AIService | null | undefined
): InitialContext {
  const ctx: RecordingContext = {
    data,
    settings,
    force: Boolean((data as unknown as { force?: boolean }).force),
    errors: [],
    traceId,
  };

  if (aiService !== undefined) {
    (ctx as RecordingContext).aiService = aiService as AIService;
  }

  return ctx as InitialContext;
}

/**
 * Assert that a context has reached a given stage.
 * Useful in tests to verify stage branding: `assertStage<PrivacyContext>(ctx, 'privacy')`
 */
export function assertStage<S extends ContextStage>(_ctx: StagedContext<S>, _stage: S): void {
  // runtime no-op, type-level only
}
