/**
 * localMarkdownExportCore.ts
 * Shared "flush the buffered daily Markdown to a download" logic, used by
 * all three auto-export timings (immediate / idle / daily). Each timing
 * decides *when* to call this and *which* days to include via `filter`.
 */

import { getSettings, StorageKeys } from '../utils/storage.js';
import { addLog, LogType } from '../utils/logger.js';
import { DAILY_BUFFER_PREFIX, buildDailyMarkdown } from './pipeline/steps/saveLocalMarkdownStep.js';
import { getActiveTemplate } from '../utils/markdownTemplateUtils.js';
import type { MarkdownExportTemplate } from '../utils/types.js';

/**
 * Download each buffered day's Markdown exactly once.
 * @param filter - optional predicate over the YYYY-MM-DD date string; when
 *   omitted, every buffered day with entries is flushed.
 */
export async function flushBufferedExports(
  filter?: (date: string) => boolean
): Promise<void> {
  try {
    const settings = await getSettings();
    const exportPath = (settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH] as string) || 'Yasumaro';
    const templates = (settings[StorageKeys.MARKDOWN_EXPORT_TEMPLATES] as MarkdownExportTemplate[]) || [];
    const activeTemplateId = settings[StorageKeys.ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID] as string | undefined;
    const activeTemplate = getActiveTemplate(templates, activeTemplateId);

    const all = await chrome.storage.local.get(Object.keys(StorageKeys));

    for (const key of Object.keys(all)) {
      if (!key.startsWith(DAILY_BUFFER_PREFIX)) continue;

      const date = key.slice(DAILY_BUFFER_PREFIX.length);
      if (filter && !filter(date)) continue;

      const entries = all[key];
      if (!Array.isArray(entries) || entries.length === 0) continue;

      // Isolate per-date failures (e.g. a legacy/poisoned entry) so one bad
      // date does not abort the flush for every other buffered date.
      try {
        const content = buildDailyMarkdown(date, entries, activeTemplate);
        const dataUrl = `data:text/markdown;base64,${btoa(unescape(encodeURIComponent(content)))}`;

        await chrome.downloads.download({
          url: dataUrl,
          filename: `${exportPath}/${date}.md`,
          saveAs: false,
          conflictAction: 'overwrite'
        });

        addLog(LogType.INFO, 'Flushed local Markdown export', {
          date,
          entryCount: entries.length
        });
      } catch (error: unknown) {
        addLog(LogType.ERROR, 'Local Markdown flush failed for date', { date, error: String(error) });
      }
    }
  } catch (error: unknown) {
    addLog(LogType.ERROR, 'Local Markdown flush failed', { error: String(error) });
  }
}
