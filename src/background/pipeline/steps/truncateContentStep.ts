/**
 * Truncate content step
 * Step 0: Content size limiting for performance and cost control
 */

import { addLog, LogType } from '../../../utils/logger.js';
import { MAX_RECORD_SIZE, truncateContentSize } from '../../recordingValidator.js';
import type { RecordingContext, PipelineStepFunction } from '../types.js';

/**
 * Truncate content if it exceeds maximum size
 * 【PII保護】切り詰められたコンテンツのみがAI APIに送信される
 * 【パフォーマンス】大きなページがパイプラインをハングさせるのを防止
 */
export const truncateContentStep: PipelineStepFunction = async (
  context: RecordingContext
): Promise<RecordingContext> => {
  const { data } = context;
  const { url, content } = data;

  if (!content) {
    return context;
  }

  // Check if content needs truncation
  const encoder = new TextEncoder();
  const encoded = encoder.encode(content);

  if (encoded.length > MAX_RECORD_SIZE) {
    const originalLength = encoded.length;
    const truncatedContent = truncateContentSize(content, MAX_RECORD_SIZE);

    addLog(LogType.WARN, 'Content truncated for recording', {
      originalLength,
      truncatedLength: MAX_RECORD_SIZE,
      url,
      traceId: context.traceId
    });

    return {
      ...context,
      truncatedContent,
      data: {
        ...data,
        content: truncatedContent
      }
    };
  }

  // No truncation needed
  return {
    ...context,
    truncatedContent: content
  };
};
