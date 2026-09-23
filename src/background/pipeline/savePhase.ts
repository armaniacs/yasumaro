/**
 * SavePhase — deep module owning the recording save tail.
 *
 * Single seam: `save(context, deps) -> SaveReceipt` (bound via
 * `createSavePhase`). Owns the 4-sink fan-out ordering, the BEST_EFFORT
 * continuation policy, and the retry-subset projection (`retryProjection()`).
 *
 * Deletion test: deleting this module forces the 4-sink order, the
 * per-sink continuation mapping, and the retry subset to reappear as
 * hand-written arrays in every caller.
 */

import { LogType } from '../../utils/logger/types.js';
import { addLog } from '../../utils/logger/core.js';
import { StorageKeys } from '../../utils/storage/types.js';
import {
  ErrorStrategy,
  type OfflineJobKind,
  type PipelineStep,
  type RecordingContext,
  type StepDeps,
} from './types.js';
import { decideStepOutcome, type OutcomeAdapters, type StepOutcome } from './recordingOutcome.js';
import type { StepExecutor } from './stepExecutor.js';
import type { RecordingResult } from '../../messaging/types.js';
import type { SqliteClient } from '../sqlite/offscreenGateway.js';
import {
  formatMarkdownStep,
  saveLocalMarkdownStep,
  saveMetadataStep,
  saveToObsidianStep,
} from './steps/index.js';
import { saveSqliteStep } from './steps/saveSqliteStep.js';
import { mapToBrowsingLogRecord } from './mappers/BrowsingLogRecordMapper.js';
import { createSaveSqliteParams } from './contextBuilder.js';

export type SaveSinkName = 'saveObsidian' | 'saveLocalMarkdown' | 'saveSqlite' | 'saveMetadata';

/** Canonical fan-out order. Reordering changes write visibility — keep Obsidian first. */
export const SAVE_SINK_ORDER: readonly SaveSinkName[] = [
  'saveObsidian',
  'saveLocalMarkdown',
  'saveSqlite',
  'saveMetadata',
];

/**
 * Explicit error mode for the sqlite-absent skip. The former inline WARN
 * branch in the orchestrator could not be distinguished from a real failure
 * by callers; the seam now reports it as a typed skip instead.
 */
export class SqliteClientAbsentError extends Error {
  constructor(url: string) {
    super(`No SqliteClient available, skipping SQLite save (url=${url})`);
    this.name = 'SqliteClientAbsentError';
  }
}

interface SaveSinkDef {
  name: SaveSinkName;
  errorStrategy: ErrorStrategy;
  offlineRetry?: { jobKind: OfflineJobKind } | undefined;
  /** Membership in the retry subset (currently only the Obsidian sink). */
  retryable: boolean;
  execute: (context: RecordingContext, deps?: StepDeps) => Promise<RecordingContext>;
}

/**
 * SQLite sink adapter. Resolves its client uniformly from StepDeps like
 * every other sink; absence is a typed skip, not an inline WARN branch.
 */
async function executeSaveSqlite(context: RecordingContext, deps?: StepDeps): Promise<RecordingContext> {
  const client = deps?.sqliteClient as SqliteClient | null | undefined;
  if (!client) {
    throw new SqliteClientAbsentError(context.data.url);
  }
  const record = mapToBrowsingLogRecord(context);
  const params = createSaveSqliteParams({
    recordId: 0,
    record,
    sqliteClient: client,
    obsidianSynced: context.obsidianDuration !== undefined ? true : undefined,
    traceId: context.traceId,
    // PBI 04: regenerate updates its own row instead of inserting.
    targetEntryId: context.data.targetEntryId,
    // Follow-up: skip the UPDATE when the AI produced no real summary.
    aiSucceeded: context.privacyResult?.aiSucceeded,
    // Same gate as mapToBrowsingLogRecord: when content storage is off the
    // UPDATE must leave the existing content column untouched, not null it.
    contentEnabled: context.settings[StorageKeys.CONTENT_STORAGE_ENABLED] === true,
  });
  await saveSqliteStep(params);
  addLog(LogType.INFO, 'Saved to SQLite', { url: context.data.url, title: context.data.title, traceId: context.traceId });
  return context;
}

/**
 * The single fan-out table. Adding a sink is one row here — the step array
 * (`savePhaseSteps`) and the retry subset (`retryProjection`) derive from it,
 * so no caller edits step arrays or dep closures.
 */
const SAVE_FAN_OUT: readonly SaveSinkDef[] = [
  {
    name: 'saveObsidian',
    errorStrategy: ErrorStrategy.BEST_EFFORT,
    offlineRetry: { jobKind: 'obsidian_sync' },
    retryable: true,
    execute: saveToObsidianStep,
  },
  {
    name: 'saveLocalMarkdown',
    errorStrategy: ErrorStrategy.BEST_EFFORT,
    retryable: false,
    execute: saveLocalMarkdownStep,
  },
  {
    name: 'saveSqlite',
    errorStrategy: ErrorStrategy.BEST_EFFORT,
    retryable: false,
    execute: executeSaveSqlite,
  },
  {
    name: 'saveMetadata',
    errorStrategy: ErrorStrategy.BEST_EFFORT,
    retryable: false,
    execute: saveMetadataStep,
  },
];

function toPipelineStep(sink: SaveSinkDef): PipelineStep {
  const step: PipelineStep = { name: sink.name, errorStrategy: sink.errorStrategy, execute: sink.execute };
  if (sink.offlineRetry !== undefined) {
    step.offlineRetry = { jobKind: sink.offlineRetry.jobKind };
  }
  return step;
}

/** Fan-out table as PipelineSteps, in canonical order. */
export function savePhaseSteps(): PipelineStep[] {
  return SAVE_FAN_OUT.map(toPipelineStep);
}

/**
 * Retry subset derived by projection: the format head plus every retryable
 * sink. Replaces the former hand-written second array; the two cannot drift.
 */
export function retryProjection(): PipelineStep[] {
  return [
    { name: 'formatMarkdown', errorStrategy: ErrorStrategy.FATAL, execute: formatMarkdownStep },
    ...SAVE_FAN_OUT.filter((sink) => sink.retryable).map(toPipelineStep),
  ];
}

export type SaveSinkStatus = 'ok' | 'skipped' | 'continued';

export interface SaveSinkOutcome {
  name: SaveSinkName;
  status: SaveSinkStatus;
  reason?: string | undefined;
}

export type SaveReceipt =
  | { terminated: false; context: RecordingContext; outcomes: SaveSinkOutcome[] }
  | { terminated: true; context: RecordingContext; outcomes: SaveSinkOutcome[]; result: RecordingResult };

export interface SavePhaseEnv {
  executor: Pick<StepExecutor, 'executeWithStrategy'>;
  outcomeAdapters: OutcomeAdapters;
}

export async function save(
  context: RecordingContext,
  deps: StepDeps,
  env: SavePhaseEnv
): Promise<SaveReceipt> {
  let ctx = context;
  const outcomes: SaveSinkOutcome[] = [];
  for (const sink of SAVE_FAN_OUT) {
    const step = toPipelineStep(sink);
    try {
      ctx = await env.executor.executeWithStrategy(step, ctx, deps);
      outcomes.push({ name: sink.name, status: 'ok' });
    } catch (error) {
      if (error instanceof SqliteClientAbsentError) {
        // Typed skip: same observable behavior as the former inline branch
        // (WARN + unchanged context + continue, nothing recorded as an error).
        addLog(LogType.WARN, 'No SqliteClient available, skipping SQLite save', {
          url: ctx.data.url,
          traceId: ctx.traceId,
        });
        outcomes.push({ name: sink.name, status: 'skipped', reason: 'sqlite-client-absent' });
        continue;
      }
      // BEST_EFFORT continuation mirrors the orchestrator loop: the outcome
      // policy owns the taxonomy, the seam only records and continues — or
      // terminates when the policy says so (e.g. RegenerateUpdateError).
      const outcome: StepOutcome = decideStepOutcome(error, step, ctx, env.outcomeAdapters);
      if (outcome.done) {
        return { terminated: true, context: ctx, outcomes, result: outcome.result };
      }
      ctx.errors.push(outcome.pipelineError);
      addLog(LogType.WARN, `Pipeline step ${step.name} failed with ${step.errorStrategy} strategy`, {
        error: (error as Error).message,
        url: ctx.data.url,
        traceId: ctx.traceId,
      });
      outcomes.push({ name: sink.name, status: 'continued' });
    }
  }
  return { terminated: false, context: ctx, outcomes };
}

export interface SavePhase {
  steps(): PipelineStep[];
  retryProjection(): PipelineStep[];
  save(context: RecordingContext, deps: StepDeps): Promise<SaveReceipt>;
}

/** Bind the execution driver once; callers use `save(context, deps)` only. */
export function createSavePhase(env: SavePhaseEnv): SavePhase {
  return {
    steps: () => savePhaseSteps(),
    retryProjection: () => retryProjection(),
    save: (context, deps) => save(context, deps, env),
  };
}
