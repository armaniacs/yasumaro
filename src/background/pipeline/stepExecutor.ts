import { addLog, LogType } from '../../utils/logger.js';
import { ErrorStrategy, type RecordingContext, type PipelineStep, type StepDeps, type OfflineJobKind } from './types.js';
import type { OfflineNetworkQueue } from '../offlineNetworkQueue.js';
import { RetryPolicy, defaultRetryPolicy } from './retryPolicy.js';

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

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
    private retryPolicy: RetryPolicy = defaultRetryPolicy
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
          await delay(delayMs);
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
