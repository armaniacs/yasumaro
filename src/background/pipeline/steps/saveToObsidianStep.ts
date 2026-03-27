/**
 * Save to Obsidian step
 * Step 8: Append formatted markdown to Obsidian daily note
 */

import { addLog, LogType } from '../../../utils/logger.js';
import { ObsidianClient } from '../../obsidianClient.js';
import type { RecordingContext, PipelineStepFunction } from '../types.js';

/**
 * Save formatted markdown to Obsidian daily note
 * This step uses RETRY error strategy - retry on failure
 */
export const saveToObsidianStep: PipelineStepFunction = async (
  context: RecordingContext
): Promise<RecordingContext> => {
  const { data, markdown } = context;
  const { url, title } = data;

  if (!markdown) {
    addLog(LogType.WARN, 'No markdown to save to Obsidian', { url });
    return context;
  }

  // Create Obsidian client
  const obsidian = new ObsidianClient();

  try {
    await obsidian.appendToDailyNote(markdown);
    addLog(LogType.INFO, 'Saved to Obsidian', { title, url });
  } catch (error: any) {
    // Throw error to trigger retry
    addLog(LogType.ERROR, 'Failed to save to Obsidian', {
      error: error.message,
      url,
      title
    });
    throw error;
  }

  return context;
};
