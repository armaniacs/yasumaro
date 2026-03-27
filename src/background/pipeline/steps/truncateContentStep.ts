/**
 * Truncate content step
 * Step 0: Content size limiting for performance and cost control
 */

import { addLog, LogType } from '../../../utils/logger.js';
import { MAX_RECORD_SIZE } from '../types.js';
import type { RecordingContext, PipelineStepFunction } from '../types.js';

// Import truncateContentSize from pipeline utils (copy from recordingLogic to avoid circular dependency)
function truncateContentSize(content: string, maxSize: number = MAX_RECORD_SIZE): string {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(content);

  if (encoded.length <= maxSize) {
    return content;
  }

  const truncated = encoded.slice(0, maxSize);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  return decoder.decode(truncated);
}

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
      url
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
