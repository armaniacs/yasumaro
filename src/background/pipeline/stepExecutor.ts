import { addLog, LogType } from '../../utils/logger.js';
import { ErrorStrategy, type RecordingContext, type PipelineStep, type StepDeps, type OfflineJobKind } from './types.js';
import type { OfflineNetworkQueue } from '../offlineNetworkQueue.js';
import { RetryPolicy, defaultRetryPolicy } from './retryPolicy.js';

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
          const delayMs = Math.min(Math.pow(2, retries) * 1000, 5000);
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

    const payload = {
      title: context.data.title,
      url: context.data.url,
      content: context.data.content,
      summary: context.privacyResult?.summary,
      maskedCount: context.privacyResult?.maskedCount,
      tags: context.privacyResult?.tags,
      // PBI 2026-09-12-04: diagnostic stats ride with the job so the offline
      // retry can rebuild the full RecordingData instead of a lossy subset.
      pageBytes: context.data.pageBytes,
      candidateBytes: context.data.candidateBytes,
      originalBytes: context.data.originalBytes,
      cleansedBytes: context.data.cleansedBytes,
      aiSummaryOriginalBytes: context.data.aiSummaryOriginalBytes,
      aiSummaryCleansedBytes: context.data.aiSummaryCleansedBytes,
      aiSummaryCleansedElements: context.data.aiSummaryCleansedElements,
      aiSummaryCleansedReason: context.data.aiSummaryCleansedReason,
      aiSummaryCleansedReasons: context.data.aiSummaryCleansedReasons,
    };

    try {
      await this.offlineNetworkQueue!.enqueue({ type, payload });
      addLog(LogType.INFO, `RecordingPipeline: queued offline job for ${step.name}`, {
        url: context.data.url,
        type,
        traceId: context.traceId,
      });
    } catch (enqueueError) {
      addLog(LogType.ERROR, 'RecordingPipeline: failed to enqueue offline job', {
        url: context.data.url,
        type,
        error: enqueueError instanceof Error ? enqueueError.message : String(enqueueError),
        traceId: context.traceId,
      });
    }
  }
}
