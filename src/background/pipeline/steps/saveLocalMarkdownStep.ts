/**
 * Save to Local Markdown step
 * Step 9: Append formatted markdown to local daily file via chrome.downloads
 *
 * Uses chrome.downloads API with conflictAction: 'overwrite' to write
 * accumulated daily entries to a local file. Entries are accumulated
 * in chrome.storage.local per day and re-downloaded after each recording.
 */

import { addLog, LogType } from '../../../utils/logger.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { StorageKeys } from '../../../utils/storage.js';
import type { RecordingContext, PipelineStepFunction } from '../types.js';

/** Storage key prefix for daily entry buffers */
export const DAILY_BUFFER_PREFIX = 'local_export_';

/**
 * Get today's date string in YYYY-MM-DD format (local timezone)
 */
function getTodayDateString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Build complete daily markdown from accumulated entries
 */
export function buildDailyMarkdown(date: string, entries: string[]): string {
  const header = `# ${date}`;
  return `${header}\n\n${entries.join('\n\n')}`;
}

/**
 * Save formatted markdown to local daily file
 * Skips silently when local markdown export is not configured.
 *
 * @param context - The current recording pipeline context
 */
export const saveLocalMarkdownStep: PipelineStepFunction = async (
  context: RecordingContext
): Promise<RecordingContext> => {
  const { data, markdown } = context;
  const { url, title } = data;

  console.log('[LocalMD] Step reached:', { url, hasMarkdown: !!markdown });

  if (!markdown) {
    addLog(LogType.WARN, '[LocalMD] No markdown to save locally', { url });
    return context;
  }

  // Check if local markdown export is enabled
  const settings = context.settings as Record<string, unknown>;
  const localExportEnabled = settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED];
  const autoExportEnabled = settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_AUTO_ENABLED];
  console.log('[LocalMD] Settings check:', { url, enabled: localExportEnabled, auto: autoExportEnabled });
  addLog(LogType.INFO, '[LocalMD] Step fired', {
    url,
    enabled: localExportEnabled,
    auto: autoExportEnabled,
    hasMarkdown: !!markdown
  });
  if (!localExportEnabled || !autoExportEnabled) {
    console.log('[LocalMD] Disabled, skipping:', { url, enabled: localExportEnabled, auto: autoExportEnabled });
    addLog(LogType.INFO, '[LocalMD] Disabled, skipping', { url });
    return context;
  }

    const exportPath = (settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH] as string) || 'Yasumaro';
    const date = getTodayDateString();
    const storageKey = `${DAILY_BUFFER_PREFIX}${date}`;

    try {
      // PBI 2026-07-09-03: Buffer only. Actual download is deferred
      // to idle / periodic flush (see localMarkdownIdleFlusher.ts).
      const stored = await chrome.storage.local.get(storageKey);
      const dailyEntries: string[] = Array.isArray(stored[storageKey]) ? stored[storageKey] : [];
      dailyEntries.push(markdown);
      await chrome.storage.local.set({ [storageKey]: dailyEntries });

      addLog(LogType.INFO, 'Buffered to local Markdown (deferred export)', {
        title,
        url,
        storageKey,
        entryCount: dailyEntries.length
      });

      return context;
    } catch (error: unknown) {
    console.error('[LocalMD] FAILED:', errorMessage(error));
    addLog(LogType.ERROR, 'Failed to save to local Markdown', {
      error: errorMessage(error),
      url,
      title
    });
    // BEST_EFFORT: log error but don't throw — continue pipeline
    return context;
  }
};
