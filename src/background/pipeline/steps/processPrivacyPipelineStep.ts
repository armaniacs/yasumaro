/**
 * Privacy pipeline processing step
 * Step 6: AI summarization and privacy processing
 */

import { addLog, LogType } from '../../../utils/logger.js';
import { StorageKeys } from '../../../utils/storage.js';
import { PrivacyPipeline } from '../../privacyPipeline.js';
import { sanitizeRegex } from '../../../utils/piiSanitizer.js';
import type { RecordingContext, PipelineStepFunction } from '../types.js';

/**
 * Process content through privacy pipeline (AI summarization)
 * This step is retryable on failure
 */
export const processPrivacyPipelineStep: PipelineStepFunction = async (
  context: RecordingContext
): Promise<RecordingContext> => {
  const { data, settings } = context;
  const { content, previewOnly, alreadyProcessed } = data;

  const pipeline = new PrivacyPipeline(settings, context.aiClient as any, { sanitizeRegex });

  const tagSummaryMode = settings[StorageKeys.TAG_SUMMARY_MODE] as boolean;

  // Measure AI processing time
  const aiStartTime = performance.now();

  try {
    const pipelineResult = await pipeline.process(content || '', {
      previewOnly,
      alreadyProcessed,
      tagSummaryMode
    });

    const aiEndTime = performance.now();
    const aiDuration = !alreadyProcessed ? aiEndTime - aiStartTime : undefined;

    if (previewOnly) {
      // Return preview result
      return {
        ...context,
        privacyResult: pipelineResult,
        aiDuration,
        result: {
          ...pipelineResult,
          success: pipelineResult.success !== undefined ? pipelineResult.success : true,
          title: data.title,
          url: data.url,
          aiDuration
        }
      };
    }

    return {
      ...context,
      privacyResult: pipelineResult,
      aiDuration,
      sanitizedSummary: pipelineResult.summary || 'Summary not available.'
    };
  } catch (error: any) {
    addLog(LogType.ERROR, 'Privacy pipeline failed', {
      error: error.message,
      url: data.url,
      previewOnly
    });

    if (previewOnly) {
      return {
        ...context,
        result: {
          success: false,
          error: error.message,
          title: data.title,
          url: data.url
        }
      };
    }

    throw error;
  }
};
