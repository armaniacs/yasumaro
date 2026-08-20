/**
 * Save to Obsidian step
 * Step 8: Append formatted markdown to Obsidian daily note
 */

import { addLog, LogType } from '../../../utils/logger.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { StorageKeys } from '../../../utils/storage/types.js';
import type { RecordingContext, StepDeps } from '../types.js';

/**
 * Save formatted markdown to Obsidian daily note
 * Skips silently when Obsidian is not configured.
 *
 * Dependencies are injected via StepDeps instead of creating ObsidianClient
 * internally. This makes the dependency explicit and testable.
 *
 * Notifications are NOT created here — the caller (handler layer) is
 * responsible for notifying the user based on the pipeline result.
 */
export const saveToObsidianStep = async (
  context: RecordingContext,
  deps?: StepDeps
): Promise<RecordingContext> => {
  const { data, markdown } = context;
  const { url, title } = data;

  if (!markdown) {
    addLog(LogType.WARN, 'No markdown to save to Obsidian', { url, traceId: context.traceId });
    return context;
  }

  // Skip if user explicitly disabled Obsidian
  const settings = context.settings as Record<string, unknown>;
  const obsidianEnabled = settings[StorageKeys.OBSIDIAN_ENABLED];
  if (obsidianEnabled === false) {
    addLog(LogType.INFO, 'Obsidian disabled by user, skipping save', { url, traceId: context.traceId });
    return context;
  }

  // Require an injected Obsidian client; production always injects via createSaveToObsidianStep
  const obsidianClient = deps?.obsidian;
  if (!obsidianClient) {
    addLog(LogType.INFO, 'No Obsidian client available, skipping save', { url, traceId: context.traceId });
    return context;
  }

  const obsidianStart = Date.now();
  try {
    await obsidianClient.appendToDailyNote(markdown, context.traceId);
    const obsidianDuration = Date.now() - obsidianStart;
    addLog(LogType.INFO, 'Saved to Obsidian', { title, url, traceId: context.traceId });

    return { ...context, obsidianDuration };
  } catch (error: unknown) {
    addLog(LogType.ERROR, 'Failed to save to Obsidian', {
      error: errorMessage(error),
      url,
      title,
      traceId: context.traceId
    });
    throw error instanceof Error ? error : new Error(errorMessage(error));
  }
};
