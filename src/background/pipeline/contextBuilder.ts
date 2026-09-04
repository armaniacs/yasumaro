/**
 * Typed Context builder for RecordingPipeline.
 *
 * RecordingContext is a 7-way intersection (PipelineInput & CheckResults & ...).
 * Out-of-order reads (e.g. reading `markdown` before formatMarkdownStep) are
 * guarded at runtime by step ordering, not by type branding: the earlier
 * stage-branded context experiment was removed because the step seam
 * (PipelineStepFunction) never consumed the brands — the promised compile-time
 * error could not fire.
 */

import type { RecordingData } from '../../messaging/types.js';
import type { Settings } from '../../utils/storage/types.js';
import type {
  RecordingContext,
  StepDeps,
} from './types.js';
import type { PrivacyPipelineResult } from '../privacyPipeline.js';
import type { ObsidianClient } from '../obsidianClient.js';
import type { AIService } from '../ai/AIService.js';
import type { SqliteClient } from '../sqlite/offscreenGateway.js';
import type { BrowsingLogRecord } from '../../utils/sqlite-types.js';
import type { SaveSqliteStepParams } from './steps/saveSqliteStep.js';
import type { UrlStore } from './types.js';

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
 * (formatMarkdown + saveToObsidian). It carries Input + PrivacyResults.
 */
export type RetryContext = RecordingContext;

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

  return base;
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

