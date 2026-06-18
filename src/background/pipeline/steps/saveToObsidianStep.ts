/**
 * Save to Obsidian step
 * Step 8: Append formatted markdown to Obsidian daily note
 */

import { addLog, LogType } from '../../../utils/logger.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { ObsidianClient } from '../../obsidianClient.js';
import { NotificationHelper } from '../../notificationHelper.js';
import { StorageKeys } from '../../../utils/storage.js';
import type { RecordingContext, PipelineStepFunction } from '../types.js';

/**
 * Save formatted markdown to Obsidian daily note
 * Skips silently when Obsidian is not configured.
 *
 * @param context - The current recording pipeline context
 * @param obsidian - The Obsidian client instance.
 *   In production, this is injected by RecordingPipeline via dependency injection (DI).
 *   The parameter is typed as optional only to allow test overrides;
 *   omitting it in production falls back to constructing a new ObsidianClient instance.
 */
export const saveToObsidianStep = async (
  context: RecordingContext,
  obsidian?: ObsidianClient
): Promise<RecordingContext> => {
  const { data, markdown } = context;
  const { url, title } = data;

  if (!markdown) {
    addLog(LogType.WARN, 'No markdown to save to Obsidian', { url });
    return context;
  }

  // ユーザーが Obsidian 使用を明示的に OFF にしている場合はスキップ（フラグ優先）
  const settings = context.settings as Record<string, unknown>;
  const obsidianEnabled = settings[StorageKeys.OBSIDIAN_ENABLED];
  if (obsidianEnabled === false) {
    addLog(LogType.INFO, 'Obsidian disabled by user, skipping save', { url });
    return context;
  }

  // If obsidian client was not injected via DI, check if Obsidian is configured
  // (e.g., in test environments or when using the default ObsidianClient fallback)
  if (!obsidian) {
    const obsidianApiKey = settings[StorageKeys.OBSIDIAN_API_KEY] as string | undefined;
    if (!obsidianApiKey || obsidianApiKey.length < 16) {
      addLog(LogType.INFO, 'Obsidian not configured, skipping save', { url });
      return context;
    }
  }

  // Use provided Obsidian client (injected via DI in production) or create new one
  const obsidianClient = obsidian || new ObsidianClient();

  const obsidianStart = Date.now();
  try {
    await obsidianClient.appendToDailyNote(markdown);
    const obsidianDuration = Date.now() - obsidianStart;
    addLog(LogType.INFO, 'Saved to Obsidian', { title, url });

    // Create notification after successful save
    const notificationTitle = chrome.i18n.getMessage('saveToObsidian') || 'Saved to Obsidian';
    NotificationHelper.notifySuccess(notificationTitle, `Saved: ${title}`);

    return { ...context, obsidianDuration };
  } catch (error: unknown) {
    addLog(LogType.ERROR, 'Failed to save to Obsidian', {
      error: errorMessage(error),
      url,
      title
    });
    throw error instanceof Error ? error : new Error(errorMessage(error));
  }
};
