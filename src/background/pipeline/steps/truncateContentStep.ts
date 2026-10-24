/**
 * Truncate content step
 * Step 0: Content size limiting for performance and cost control
 */

import { LogType } from '../../../utils/logger/types.js';
import { addLog } from '../../../utils/logger/core.js';
import { MAX_RECORD_SIZE } from '../../../utils/limits.js';
import { truncateForRecording } from '../../recordingValidator.js';
import type { RecordingContext, PipelineStepFunction } from '../types.js';

/**
 * Truncate content if it exceeds maximum size.
 * Thin adapter: byte semantics are owned by truncateForRecording.
 * This step only maps the result onto the pipeline context and logs.
 * PII protection: only truncated content reaches AI APIs.
 * Performance: large pages cannot hang the pipeline.
 */
export const truncateContentStep: PipelineStepFunction = async (
  context: RecordingContext
): Promise<RecordingContext> => {
  const { data } = context;
  const { url, content } = data;

  if (!content) {
    return context;
  }

  const result = truncateForRecording(content);

  if (!result.truncated) {
    // No truncation needed
    return {
      ...context,
      truncatedContent: content
    };
  }

  addLog(LogType.WARN, 'Content truncated for recording', {
    originalLength: result.originalBytes,
    truncatedLength: MAX_RECORD_SIZE,
    url,
    traceId: context.traceId
  });

  return {
    ...context,
    truncatedContent: result.content,
    data: {
      ...data,
      content: result.content
    }
  };
};
