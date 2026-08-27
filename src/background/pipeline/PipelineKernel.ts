/**
 * PipelineKernel — thin wrapper that owns the pipeline execution.
 * PBI-13A: Extracted from RecordingPipeline.executeInternal to isolate
 * retry/offline and previewBreakpoint logic. RecordingPipeline.record() remains
 * as a facade for backward compatibility.
 */

import { addLog, LogType } from '../../utils/logger.js';
import { pickDefined } from '../../utils/objectUtils.js';
import { ErrorStrategy, type RecordingContext, type PipelineStep, type PipelineError, type StepDeps } from './types.js';
import { buildResult, buildErrorResult, buildPrivatePageResult, notifyObsidianSaveSuccess, notifyRecordingError } from './resultBuilder.js';
import { PrivatePageError, DuplicateError } from './steps/index.js';
import { PerUrlMutexMap } from './perUrlMutex.js';
import { StepExecutor } from './stepExecutor.js';
import type { RecordingData, RecordingResult } from '../../messaging/types.js';
import type { Settings } from '../../utils/storage/types.js';
import { toExternalResult } from './piiBoundary.js';

export class PipelineKernel {
  constructor(
    private steps: PipelineStep[],
    private mutexMap: PerUrlMutexMap,
    private executor: StepExecutor,
  ) {}

  async execute(data: RecordingData, settings: Settings, deps: StepDeps, traceId: string): Promise<RecordingResult> {
    return this.executeInternal(data, settings, deps, traceId);
  }

  private async executeInternal(data: RecordingData, settings: Settings, deps: StepDeps, traceId: string): Promise<RecordingResult> {
    let context: RecordingContext = { data, settings, force: data.force || false, aiService: deps.aiService as never, traceId, errors: [] };

    for (const step of this.steps) {
      try {
        context = await this.executor.executeWithStrategy(step, context, deps);
        if (data.previewOnly && context.result && step.previewBreakpoint) return toExternalResult(context.result);
      } catch (error) {
        if (error instanceof PrivatePageError) return buildPrivatePageResult(context, error);
        if (error instanceof DuplicateError) return { success: true, skipped: true, reason: error.reason, title: data.title, url: data.url };
        if (step.errorStrategy === ErrorStrategy.FATAL || step.errorStrategy === ErrorStrategy.RETRY) {
          const errorResult = buildErrorResult(context, error as Error, step.name);
          notifyRecordingError(context.data.title, (error as Error).message);
          return errorResult;
        }
        const pipelineError: PipelineError = {
          step: step.name, error: error as Error, strategy: step.errorStrategy, timestamp: Date.now(),
          ...pickDefined({ recoveryKind: step.offlineRetry?.jobKind }),
          context: { url: context.data.url, tabId: undefined }
        };
        context.errors.push(pipelineError);
        addLog(LogType.WARN, `Pipeline step ${step.name} failed with ${step.errorStrategy} strategy`, { error: (error as Error).message, url: data.url, traceId: context.traceId });
      }
    }

    const result = buildResult(context);
    if (result.success && result.obsidianDuration != null) notifyObsidianSaveSuccess(data.title);
    return result;
  }
}
