/**
 * recordingOutcome.ts — deep module owning the full outcome policy.
 *
 * Single seam: `decideStepOutcome()` for the catch path, `finalizeSuccess()`
 * for the success path. Error taxonomy (PrivatePage / Duplicate / FATAL+RETRY
 * / BEST_EFFORT-continue), pending-recovery registration, and user notices
 * live here instead of being split between the orchestrator catch and the
 * result builders. The orchestrator keeps only the step loop.
 *
 * Side-effect adapters (notifier / pending writer) are injectable: production
 * uses chrome + storage, tests use in-memory fakes. Logging stays on the
 * shared logger seam (mocked in tests like everywhere else in this codebase).
 *
 * Deletion test: deleting this module forces the catch mapping + two
 * pending-registration sites + two notify sites to reappear inline in every
 * execution path (full / preview / retry subset).
 */

import { addLog, logError, LogType, ErrorCode } from '../../utils/logger.js';
import { addPendingPage } from '../../utils/pendingStorage.js';
import { pickDefined } from '../../utils/objectUtils.js';
import {
  buildErrorResult,
  buildPrivatePageResult,
  buildResult,
  notifyRecordingError,
  notifyObsidianSaveSuccess,
} from './resultBuilder.js';
import { PrivatePageError, DuplicateError } from './steps/index.js';
import { ErrorStrategy, type OfflineJobKind, type PipelineError, type RecordingContext } from './types.js';
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

export interface OutcomeAdapters {
  notifier: OutcomeNotifier;
  pending: OutcomePendingWriter;
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

export const defaultOutcomeAdapters: OutcomeAdapters = {
  notifier: prodNotifier,
  pending: prodPending,
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

const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

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
  if (thrown instanceof PrivatePageError) {
    return { done: true, result: buildPrivatePageResult(context, thrown) };
  }
  if (thrown instanceof DuplicateError) {
    const { data } = context;
    return {
      done: true,
      result: { success: true, skipped: true, reason: thrown.reason, title: data.title, url: data.url },
    };
  }
  const error = thrown as Error;
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
    adapters.pending.addPending(pendingEntry(context, 'pipeline-error', error.message));
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
    context: { url: context.data.url, tabId: undefined },
  };
  return { done: false, pipelineError };
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
  if (obsidianError) {
    adapters.pending.addPending(pendingEntry(context, 'obsidian-write-failed', obsidianError.error.message));
  }

  const result = buildResult(context);
  if (result.success && result.obsidianDuration != null) {
    adapters.notifier.notifySaveSuccess(data.title);
  }
  return result;
}
