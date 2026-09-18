import { addLog, LogType } from '../../utils/logger.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { backoffDelayMs } from '../../utils/backoff.js';
import { ErrorStrategy, type RecordingContext, type PipelineStep, type StepDeps, type OfflineJobKind } from './types.js';
import type { OfflineNetworkQueue } from '../offlineNetworkQueue.js';
import { RetryPolicy, defaultRetryPolicy } from './retryPolicy.js';
import { extractOfflinePayload } from '../recordRequestBuilder.js';

/** Injectable clock seam for the retry backoff. Defaults to the real timer. */
export type StepDelayFn = (ms: number) => Promise<void>;

const realDelay: StepDelayFn = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Executes pipeline steps with retry and offline-queue fallback.
 *
 * Extracted from RecordingPipeline to isolate retry/backoff and offline
 * enqueue logic. The steps table and outer orchestration remain in
 * RecordingPipeline.
 */
export class StepExecutor {
  constructor(
    private offlineNetworkQueue: OfflineNetworkQueue | null,
    private retryPolicy: RetryPolicy = defaultRetryPolicy,
    private delay: StepDelayFn = realDelay
  ) {}

  async executeWithStrategy(
    step: PipelineStep,
    context: RecordingContext,
    deps: StepDeps
  ): Promise<RecordingContext> {
    let retries = 0;

    while (true) {
      try {
        return await step.execute(context, deps);
      } catch (error) {
        if (step.errorStrategy === ErrorStrategy.RETRY && retries < (step.maxRetries || 0)) {
          retries++;
          // retries は 1-origin の legacy 系列再現のため -1 しない（parity テストで pin）。
          const delayMs = backoffDelayMs(retries, { baseMs: 1000, maxMs: 5000 });
          addLog(LogType.INFO, `Retrying step ${step.name} (attempt ${retries}/${step.maxRetries})`, {
            delayMs,
            url: context.data.url,
            traceId: context.traceId
          });
          await this.delay(delayMs);
          continue;
        }

        if (this.offlineNetworkQueue && step.offlineRetry && this.retryPolicy.shouldEnqueueForOffline(error)) {
          await this.enqueueOfflineJob(step, context);
        }

        throw error;
      }
    }
  }

  private async enqueueOfflineJob(
    step: PipelineStep,
    context: RecordingContext
  ): Promise<void> {
    if (!step.offlineRetry) {
      return;
    }

    const type: OfflineJobKind = step.offlineRetry.jobKind;

    // PBI 2026-09-12-11: pack through the shared field table so enqueue and
    // retry cannot diverge (the table lives in recordRequestBuilder).
    const payload = extractOfflinePayload(context);

    try {
      // enqueue は失敗時に false を返し throw しない（PBI 2026-09-17-15）。
      const queued = await this.offlineNetworkQueue!.enqueue({ type, payload });
      if (!queued) {
        addLog(LogType.ERROR, 'RecordingPipeline: failed to enqueue offline job', {
          url: context.data.url,
          type,
          traceId: context.traceId,
        });
        return;
      }
      addLog(LogType.INFO, `RecordingPipeline: queued offline job for ${step.name}`, {
        url: context.data.url,
        type,
        traceId: context.traceId,
      });
    } catch (enqueueError) {
      addLog(LogType.ERROR, 'RecordingPipeline: failed to enqueue offline job', {
        url: context.data.url,
        type,
        error: errorMessage(enqueueError),
        traceId: context.traceId,
      });
    }
  }
}
