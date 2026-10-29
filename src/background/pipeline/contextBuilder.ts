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
import type { PrivacyInfo } from '../../utils/privacyChecker.js';

// ---------------------------------------------------------------------------
// Retry context — explicit input for retryObsidianWrite (no AI re-run)
// ---------------------------------------------------------------------------

export interface RetryJobInput {
  title: string;
  url: string;
  summary: string;
  tags?: string[] | undefined;
  /**
   * PBI 2026-09-25-13: pipeline-final markdown frozen in the offline payload.
   * When present, the retry subset must not re-run formatMarkdownStep — the
   * replay body must be byte-identical to the failed first attempt.
   */
  markdown?: string | undefined;
}

/**
 * The three retry-write flags as one bundle (PBI 2026-10-16-09).
 *
 * Retry correctness used to depend on three independent flags agreeing with
 * each other: the `replayWrite` marker, the frozen pipeline-final `markdown`
 * body, and the idempotent (`dedupe`) write option. They are now built once
 * here and travel together — the retry path references this bundle, never
 * the flags individually.
 */
export interface RetryWriteFlags {
  /** Replay marker consumed by the saveObsidian sink. */
  readonly replayWrite: true;
  /**
   * Idempotent-write option for the Obsidian client. Always pairs with
   * `replayWrite`: a replay must never stack a second copy of identical
   * section content.
   */
  readonly dedupe: true;
  /**
   * Frozen pipeline-final markdown. Absent for legacy payloads — those
   * regenerate through the format head as before.
   */
  readonly markdown?: string | undefined;
}

/**
 * RetryContext is the narrow context for the retry pipeline
 * (formatMarkdown head + retryable save sinks, no AI re-run). It carries
 * Input + PrivacyResults plus the single `retry` bundle above; `replayWrite`
 * and `markdown` on the context itself derive from that bundle so the sink
 * steps (which read the context fields) keep working unchanged.
 */
export type RetryContext = RecordingContext & {
  readonly replayWrite: true;
  readonly retry: RetryWriteFlags;
};

export function createRetryContext(
  job: RetryJobInput,
  settings: Settings,
  traceId?: string | undefined
): RetryContext {
  // Typed builder: tags are assigned via explicit conditional, not
  // generic pickDefined spread, so the optional slice is visible in the type.
  const privacyResult: PrivacyPipelineResult = buildPrivacyResult(job.summary, job.tags);

  // Single construction site for the 3 retry-write flags: replay marker,
  // dedupe write option, and frozen markdown travel as one bundle, and the
  // context fields below derive from it.
  const retry: RetryWriteFlags =
    job.markdown !== undefined
      ? { replayWrite: true, dedupe: true, markdown: job.markdown }
      : { replayWrite: true, dedupe: true };

  const base: RetryContext = {
    data: { title: job.title, url: job.url, content: '' } as RecordingData,
    settings,
    force: true,
    replayWrite: retry.replayWrite,
    retry,
    errors: [],
    privacyResult,
  };

  if (retry.markdown !== undefined) {
    base.markdown = retry.markdown;
  }

  if (traceId !== undefined) {
    base.traceId = traceId;
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
  /** PBI 2026-10-22-05: the real privacy-headers verdict reader (webhook sink). */
  privacyReader?: ((url: string) => Promise<PrivacyInfo | null>) | undefined;
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

  if (input.privacyReader !== undefined) {
    deps.privacyReader = input.privacyReader;
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
  /** PBI 04: UPDATE-in-place target for regenerate. */
  targetEntryId?: number | undefined;
  /** PBI 2026-09-22-04 follow-up: mirrors context.privacyResult.aiSucceeded. */
  aiSucceeded?: boolean | undefined;
  /** PBI 04: content-storage gate — false omits the content key from the UPDATE. */
  contentEnabled?: boolean | undefined;
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

  if (input.targetEntryId !== undefined) {
    params.targetEntryId = input.targetEntryId;
  }

  if (input.aiSucceeded !== undefined) {
    params.aiSucceeded = input.aiSucceeded;
  }

  if (input.contentEnabled !== undefined) {
    params.contentEnabled = input.contentEnabled;
  }

  return params;
}

