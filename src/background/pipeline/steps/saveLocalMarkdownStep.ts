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
import { renderFileTemplate } from '../../../utils/markdownTemplateUtils.js';
import type { MarkdownExportTemplate } from '../../../utils/types.js';

/** Storage key prefix for daily entry buffers */
export const DAILY_BUFFER_PREFIX = 'local_export_';

/**
 * Build complete daily markdown from accumulated entries using the given template
 */
export function buildDailyMarkdown(
  date: string,
  entries: MarkdownEntry[],
  template: MarkdownExportTemplate
): string {
  return renderFileTemplate(template, entries.map(e => e.entryData), date);
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
    addLog(LogType.WARN, '[LocalMD] No markdown to save locally', { url, traceId: context.traceId });
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
    hasMarkdown: !!markdown,
    traceId: context.traceId
  });
  if (!localExportEnabled || timing === 'manual' || !timing) {
    addLog(LogType.INFO, '[LocalMD] Disabled, skipping', { url, traceId: context.traceId });
    return context;
  }

    try {
      const markdownBuffer = new MarkdownBufferManager();

      if (!context.markdownEntryData) {
        addLog(LogType.WARN, '[LocalMD] No markdownEntryData to save locally', { url, traceId: context.traceId });
        return context;
      }

      markdownBuffer.add({
        url,
        title: title || '',
        visitedAt: Date.now(),
        entryData: context.markdownEntryData,
      });
      await markdownBuffer.flush();
      markdownBuffer.scheduleDailyFlush();

      addLog(LogType.INFO, 'Buffered to local Markdown (deferred export)', {
        title,
        url,
        traceId: context.traceId,
      });

      return context;
    } catch (error: unknown) {
    console.error('[LocalMD] FAILED:', errorMessage(error));
    addLog(LogType.ERROR, 'Failed to save to local Markdown', {
      error: errorMessage(error),
      url,
      title,
      traceId: context.traceId
    });
    // BEST_EFFORT: log error but don't throw — continue pipeline
    return context;
  }
};
