/**
 * Save to Obsidian step
 * Step 8: Append formatted markdown to Obsidian daily note
 */

import { addLog, LogType } from '../../../utils/logger.js';
import { ObsidianClient } from '../../obsidianClient.js';
import { NotificationHelper } from '../../notificationHelper.js';
import type { RecordingContext, PipelineStepFunction } from '../types.js';

/**
 * Save formatted markdown to Obsidian daily note
 * This step uses RETRY error strategy - retry on failure
 */
export const saveToObsidianStep = async (
  context: RecordingContext,
  obsidian?: ObsidianClient
): Promise<RecordingContext> => {
  const { data, markdown } = context;
  const { url, title } = data;

  console.log('saveToObsidianStep: Called with', { title, url, hasMarkdown: !!markdown });

  if (!markdown) {
    addLog(LogType.WARN, 'No markdown to save to Obsidian', { url });
    return context;
  }

  // Use provided Obsidian client or create new one
  const obsidianClient = obsidian || new ObsidianClient();

  try {
    console.log('saveToObsidianStep: Attempting to save to Obsidian', { title, url });
    await obsidianClient.appendToDailyNote(markdown);
    addLog(LogType.INFO, 'Saved to Obsidian', { title, url });
    
    // Create notification after successful save
    NotificationHelper.notifySuccess('Saved to Obsidian', `Saved: ${title}`);
  } catch (error: any) {
    console.log('saveToObsidianStep: Failed to save to Obsidian', { error: error.message, title, url });
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
