/**
 * Duplicate check step
 * Step 5: Check if URL was already recorded today
 */

import { addLog, LogType } from '../../../utils/logger.js';
import { getSavedUrlsWithTimestamps, MAX_URL_SET_SIZE, URL_WARNING_THRESHOLD } from '../../../utils/storage/savedUrlRepository.js';
import type { RecordingContext, PipelineStepFunction, StepDeps } from '../types.js';

const defaultUrlStore = { getSavedUrlsWithTimestamps };

/**
 * Check for duplicate URL (same day based on UTC)
 * Also checks URL set size limits
 */
export const checkDuplicateStep: PipelineStepFunction = async (
  context: RecordingContext,
  deps?: StepDeps
): Promise<RecordingContext> => {
  const { data } = context;
  const { url, skipDuplicateCheck } = data;

  const urlStore = deps?.urlStore ?? defaultUrlStore;
  const urlMap = await urlStore.getSavedUrlsWithTimestamps();

  // Skip check if flag is set
  if (!skipDuplicateCheck) {
    const savedTimestamp = urlMap.get(url);
    if (savedTimestamp) {
      const savedDate = new Date(savedTimestamp);
      const today = new Date();

      // UTC-based same day check
      if (
        savedDate.getUTCFullYear() === today.getUTCFullYear() &&
        savedDate.getUTCMonth() === today.getUTCMonth() &&
        savedDate.getUTCDate() === today.getUTCDate()
      ) {
        addLog(LogType.DEBUG, 'Duplicate URL skipped (same day)', {
          url,
          savedDate: savedDate.toUTCString(),
          traceId: context.traceId
        });
        throw new DuplicateError('same_day');
      }
    }
  }

  // Check URL set size limit
  if (urlMap.size >= MAX_URL_SET_SIZE) {
    addLog(LogType.ERROR, 'URL set size limit exceeded', {
      current: urlMap.size,
      max: MAX_URL_SET_SIZE,
      url,
      traceId: context.traceId
    });
    throw new Error('URL_SET_LIMIT_EXCEEDED');
  }

  // Warning threshold
  if (urlMap.size >= URL_WARNING_THRESHOLD) {
    addLog(LogType.WARN, 'URL set size approaching limit', {
      current: urlMap.size,
      threshold: URL_WARNING_THRESHOLD,
      remaining: MAX_URL_SET_SIZE - urlMap.size,
      traceId: context.traceId
    });
  }

  return context;
};

/**
 * Custom error for duplicate detection
 */
export class DuplicateError extends Error {
  public reason: string;

  constructor(reason: string) {
    super('Duplicate detected');
    this.reason = reason;
  }
}
