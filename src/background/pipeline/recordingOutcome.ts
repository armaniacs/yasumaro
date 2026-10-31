/**
 * recordingOutcome.ts — deep module owning the full outcome policy.
 *
 * Single seam: `decideStepOutcome()` for the catch path, `finalizeSuccess()`
 * for the success path. Error taxonomy (PrivatePage / Duplicate / FATAL+RETRY
 * / BEST_EFFORT-continue), pending-recovery registration, and user notices
 * live here instead of being split between the orchestrator catch and the
 * result builders. The orchestrator keeps only the step loop.
 *
 * Side-effect adapters (notifier / pending writer / skipRecorder) are
 * injectable: production uses chrome + storage, tests use in-memory fakes.
 * Logging stays on the shared logger seam (mocked in tests like everywhere
 * else in this codebase).
 *
 * PBI 2026-10-31-01: the terminal branches of `decideStepOutcome()` also
 * record the latest skip reason (PrivatePage / Duplicate / Regenerate /
 * FATAL+RETRY -> pipeline-error). The BEST_EFFORT continue path records none —
 * the pipeline may still succeed, and a recorded skip would contradict the
 * success result. `finalizeSuccess()` records none either: a success is not a
 * skip.
 *
 * Deletion test: deleting this module forces the catch mapping + two
 * pending-registration sites + two notify sites to reappear inline in every
 * execution path (full / preview / retry subset).
 */

import { LogType, ErrorCode } from '../../utils/logger/types.js';
import { addLog } from '../../utils/logger/core.js';
import { logError } from '../../utils/logger/api.js';
import { addPendingPage, PENDING_MAX_TTL_MS } from '../../utils/pendingStorage.js';
import { pickDefined } from '../../utils/objectUtils.js';
import { recordSkipReason, type SkipReasonCode } from '../../utils/skipReason.js';
import {
  buildErrorResult,
  buildPrivatePageResult,
  buildResult,
  notifyRecordingError,
  notifyObsidianSaveSuccess,
} from './resultBuilder.js';
import { PrivatePageError, DuplicateError, RegenerateUpdateError } from './steps/index.js';
import { ErrorStrategy, decideRecoveryOwner, unwrapStepFailure, type OfflineJobKind, type PipelineError, type RecordingContext } from './types.js';
import type { RecordingResult } from '../../messaging/types.js';

/**
 * Notifier adapter: shows the user-visible outcome of a recording.
 * Production: chrome notifications. Tests: in-memory fake.
 */
export interface OutcomeNotifier {
  notifyError(title: string, message: string): void;
  notifySaveSuccess(title: string): void;
}

/**
 * Pending-write adapter: registers failed recordings for later recovery.
 * Production: pendingStorage. Tests: in-memory fake.
 */
export interface OutcomePendingWriter {
  addPending(entry: Parameters<typeof addPendingPage>[0]): void;
}

/**
 * Skip-reason adapter (PBI 2026-10-31-01): records the latest skip reason so
 * the popup can show it. Production: the chrome.storage.session store in
 * skipReason.ts. Tests: in-memory fake. The payload is the reason code ONLY —
 * never a URL, a title, or content (軸3「収集を増やさない」).
 */
export interface OutcomeSkipRecorder {
  recordSkip(reason: SkipReasonCode): void;
}

export interface OutcomeAdapters {
  notifier: OutcomeNotifier;
  pending: OutcomePendingWriter;
  skipRecorder: OutcomeSkipRecorder;
}

const prodNotifier: OutcomeNotifier = {
  notifyError: (title, message) => notifyRecordingError(title, message),
  notifySaveSuccess: (title) => notifyObsidianSaveSuccess(title),
};

const prodPending: OutcomePendingWriter = {
  addPending: (entry) => {
    void addPendingPage(entry);
  },
};

const prodSkipRecorder: OutcomeSkipRecorder = {
  recordSkip: (reason) => {
    void recordSkipReason(reason);
  },
};

export const defaultOutcomeAdapters: OutcomeAdapters = {
  notifier: prodNotifier,
  pending: prodPending,
  skipRecorder: prodSkipRecorder,
};

/** Step descriptor the outcome policy needs. Satisfied by PipelineStep. */
export interface OutcomeStep {
  name: string;
  errorStrategy: ErrorStrategy;
  offlineRetry?: { jobKind: OfflineJobKind } | undefined;
}

export type StepOutcome =
  | { done: true; result: RecordingResult }
  | { done: false; pipelineError: PipelineError };

/**
 * Pending-entry lifetime — SSOT via pendingStorage's PENDING_MAX_TTL_MS.
 * The offline-queue handover (offlineQueueProcessor) assigns the same TTL, so
 * one constant keeps every recovery path's expiry inside the same clamp.
 */
const PENDING_TTL_MS = PENDING_MAX_TTL_MS;

function pendingEntry(
  context: RecordingContext,
  reason: 'pipeline-error' | 'obsidian-write-failed',
  errorMessage: string,
): Parameters<typeof addPendingPage>[0] {
  return {
    url: context.data.url,
    title: context.data.title,
    timestamp: Date.now(),
    reason,
    errorMessage,
    expiry: Date.now() + PENDING_TTL_MS,
  };
}

/**
 * Decide the outcome of a step that threw. Returns either a terminal result
 * (orchestrator returns it) or a PipelineError (orchestrator records it and
 * continues the loop for BEST_EFFORT steps).
 */
export function decideStepOutcome(
  thrown: unknown,
  step: OutcomeStep,
  context: RecordingContext,
  adapters: OutcomeAdapters = defaultOutcomeAdapters,
): StepOutcome {
  // PBI 2026-10-16-04: the enqueue result arrives in a typed StepFailureError
  // carrier (or an explicit PipelineError field), never as a dynamic property
  // on the error. Unwrap first so every branch below sees the original error.
  const { error: original, enqueued } = unwrapStepFailure(thrown);
  if (original instanceof PrivatePageError) {
    // PBI 2026-10-31-01: the popup answers "why was this not recorded" from
    // the latest skip reason, so the settled refusal records it here.
    adapters.skipRecorder.recordSkip('private-page');
    return { done: true, result: buildPrivatePageResult(context, original) };
  }
  if (original instanceof DuplicateError) {
    const { data } = context;
    // PBI 2026-10-31-01: 同日重複 — the popup shows the reason with its
    // consecutive count (a second skipped attempt reads "×2").
    adapters.skipRecorder.recordSkip('duplicate');
    return {
      done: true,
      result: { success: true, skipped: true, reason: original.reason, title: data.title, url: data.url },
    };
  }
  const error = original as Error;
  if (original instanceof RegenerateUpdateError) {
    // Regenerate is UPDATE-only: the pending-recovery queue replays MANUAL
    // records as INSERTs by URL — recovering this failure that way would
    // duplicate the very row the update was replacing. Terminal error,
    // notice, NO pending (row stays unchanged → non-destructive).
    logError(
      `Pipeline failed at step ${step.name}`,
      { error: error.message, url: context.data.url, tabId: undefined },
      ErrorCode.INTERNAL_ERROR,
      'RecordingPipeline',
    );
    // PBI 2026-10-31-01: a terminal regenerate failure is a "not recorded"
    // reason the popup shows, like the FATAL/RETRY branch below.
    adapters.skipRecorder.recordSkip('pipeline-error');
    const result = buildErrorResult(context, error);
    adapters.notifier.notifyError(context.data.title, error.message);
    return { done: true, result };
  }
  if (step.errorStrategy === ErrorStrategy.FATAL || step.errorStrategy === ErrorStrategy.RETRY) {
    logError(
      `Pipeline failed at step ${step.name}`,
      {
        error: error.message,
        url: context.data.url,
        tabId: undefined,
      },
      ErrorCode.INTERNAL_ERROR,
      'RecordingPipeline',
    );
    // PBI 2026-10-31-01: a terminal pipeline failure is a "not recorded"
    // reason the popup shows — the notice alone never reaches a closed popup.
    adapters.skipRecorder.recordSkip('pipeline-error');
    // PBI 2026-09-22-04: regenerate is UPDATE-only — pending-page recovery
    // replays a MANUAL_RECORD INSERT that would duplicate the row being
    // replaced. The failure still surfaces as an error result + notice.
    // PBI 2026-09-25-12: when the offline enqueue succeeded, the offline job
    // is the sole recovery owner — a pending page for the same recording
    // would let the 5-minute alarm retry and a manual re-run run it twice.
    // PBI 2026-10-16-04: both rules live in decideRecoveryOwner alone.
    const owner = decideRecoveryOwner({ targetEntryId: context.data.targetEntryId, enqueued });
    if (owner === 'pending') {
      adapters.pending.addPending(pendingEntry(context, 'pipeline-error', error.message));
    }
    const result = buildErrorResult(context, error);
    adapters.notifier.notifyError(context.data.title, error.message);
    return { done: true, result };
  }
  const pipelineError: PipelineError = {
    step: step.name,
    error,
    strategy: step.errorStrategy,
    timestamp: Date.now(),
    ...pickDefined({ recoveryKind: step.offlineRetry?.jobKind }),
    // Explicit enqueue channel (PBI 2026-10-16-04): finalizeSuccess reads the
    // owner from here instead of a dynamic Error attachment.
    ...(enqueued ? { offlineEnqueued: true } : {}),
    context: { url: context.data.url, tabId: undefined },
  };
  return { done: false, pipelineError };
}

export type StepFailureDisposition =
  | { done: true; result: RecordingResult }
  | { done: false };

/**
 * Shared catch-continuation for the pre-save and save loops: resolves the
 * outcome, records BEST_EFFORT errors and emits the WARN in one place.
 * Terminal mapping stays with callers (orchestrator returns the result,
 * SavePhase returns a receipt); `outcomes.push` and the sqlite-absent skip
 * stay with callers too. Log wording/order matches the former inline blocks.
 */
export function handleStepFailure(
  thrown: unknown,
  step: OutcomeStep,
  context: RecordingContext,
  adapters: OutcomeAdapters = defaultOutcomeAdapters,
): StepFailureDisposition {
  const outcome = decideStepOutcome(thrown, step, context, adapters);
  if (outcome.done) return outcome;
  context.errors.push(outcome.pipelineError);
  addLog(LogType.WARN, `Pipeline step ${step.name} failed with ${step.errorStrategy} strategy`, {
    error: (thrown as Error).message,
    url: context.data.url,
    traceId: context.traceId,
  });
  return { done: false };
}

/**
 * Build the success result and perform success-path side effects:
 * non-fatal error summary log, obsidian_sync recovery registration, and the
 * conditional save-success notice. Replaces the orchestrator tail
 * (buildResult + obsidianDuration notify check).
 */
export function finalizeSuccess(
  context: RecordingContext,
  adapters: OutcomeAdapters = defaultOutcomeAdapters,
): RecordingResult {
  const { data, errors } = context;

  if (errors.length > 0) {
    addLog(LogType.INFO, 'Pipeline completed with non-fatal errors', {
      url: data.url,
      errorCount: errors.length,
      errorSteps: errors.map((e) => e.step),
      traceId: context.traceId,
    });
  }

  const obsidianError = errors.find((e) => e.recoveryKind === 'obsidian_sync');
  // PBI 2026-09-25-12: BEST_EFFORT saveObsidian follows the same owner rule —
  // when the offline enqueue succeeded the queued obsidian_sync job is the
  // only recovery owner and no pending page is registered for the recording.
  // PBI 2026-10-16-04: same decideRecoveryOwner as the FATAL/RETRY path, so a
  // regenerate record (UPDATE-only) registers no pending here either.
  const obsidianOwner = decideRecoveryOwner({
    targetEntryId: context.data.targetEntryId,
    enqueued: obsidianError?.offlineEnqueued === true,
  });
  if (obsidianError && obsidianOwner === 'pending') {
    adapters.pending.addPending(pendingEntry(context, 'obsidian-write-failed', obsidianError.error.message));
  }

  const result = buildResult(context);
  if (result.success && result.obsidianDuration != null) {
    adapters.notifier.notifySaveSuccess(data.title);
  }
  return result;
}
