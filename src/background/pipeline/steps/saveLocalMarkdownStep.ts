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
import { MarkdownBufferManager } from '../buffers/MarkdownBufferManager.js';
import type { MarkdownEntry } from '../buffers/MarkdownBufferManager.js';

/** Storage key prefix for daily entry buffers */
export const DAILY_BUFFER_PREFIX = 'local_export_';

/**
 * Build complete daily markdown from accumulated entries
 */
export function buildDailyMarkdown(date: string, entries: MarkdownEntry[]): string {
  const header = `# ${date}`;
  return `${header}\n\n${entries.map(e => e.markdown).join('\n\n')}`;
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
  const timing = settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_TIMING] as
    | 'manual' | 'immediate' | 'idle' | 'daily' | undefined;
  addLog(LogType.INFO, '[LocalMD] Step fired', {
    url,
    enabled: localExportEnabled,
    timing,
    hasMarkdown: !!markdown
  });
  if (!localExportEnabled || timing === 'manual' || !timing) {
    addLog(LogType.INFO, '[LocalMD] Disabled, skipping', { url });
    return context;
  }

    try {
      const markdownBuffer = new MarkdownBufferManager();

      markdownBuffer.add({
        url,
        title: title || '',
        visitedAt: Date.now(),
        markdown,
      });
      await markdownBuffer.flush();
      markdownBuffer.scheduleDailyFlush();

      addLog(LogType.INFO, 'Buffered to local Markdown (deferred export)', {
        title,
        url,
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
