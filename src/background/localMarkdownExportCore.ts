/**
 * localMarkdownExportCore.ts
 * Shared "flush the buffered daily Markdown to a download" logic, used by
 * all three auto-export timings (immediate / idle / daily). Each timing
 * decides *when* to call this and *which* days to include via `filter`.
 */

import { settingsRepository, type SettingsReader } from '../utils/storage/SettingsRepository.js';
import { DEFAULT_SETTINGS } from '../utils/storage/defaults.js';
import { StorageKeys } from '../utils/storage/types.js';
import { addLog, LogType } from '../utils/logger.js';
import { DAILY_BUFFER_PREFIX, buildDailyMarkdown } from './pipeline/steps/saveLocalMarkdownStep.js';
import { getActiveTemplate } from '../utils/markdownTemplateUtils.js';
import { recordDownloadId } from './localMarkdownExportRetention.js';

/**
 * Download each buffered day's Markdown exactly once.
 * @param filter - optional predicate over the YYYY-MM-DD date string; when
 *   omitted, every buffered day with entries is flushed.
 */
export async function flushBufferedExports(
  filter?: (date: string) => boolean,
  repo: SettingsReader = settingsRepository,
): Promise<void> {
  try {
    const settings = await repo.getAll();
    const exportPath = settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH]
      ?? (DEFAULT_SETTINGS[StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH] as string);
    const templates = settings[StorageKeys.MARKDOWN_EXPORT_TEMPLATES] ?? [];
    const activeTemplateId = settings[StorageKeys.ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID];
    const activeTemplate = getActiveTemplate(templates, activeTemplateId);

    // Deliberately no-arg (fetch all of storage): the daily buffer keys this
    // loop looks for (`local_export_YYYY-MM-DD`, DAILY_BUFFER_PREFIX) are
    // dynamic and never enumerated in StorageKeys, so a keyed get() cannot
    // find them — see 195ff96 (keyed get(), broke this feature entirely)
    // and its revert. Full-storage reads are safe here: unlimitedStorage is
    // granted, large content is capped elsewhere, and history lives in SQLite.
    const all = await chrome.storage.local.get();

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

        const downloadId = await chrome.downloads.download({
          url: dataUrl,
          filename: `${exportPath}/${date}.md`,
          saveAs: false,
          conflictAction: 'overwrite'
        });

        if (typeof downloadId === 'number') {
          await recordDownloadId(downloadId, date);
        }

        // VULN-004: drop the daily buffer key now that it is safely written, so
        // flushed keys do not accumulate in chrome.storage.local. Only reached
        // when download() (and buildDailyMarkdown) succeeded for this date.
        await chrome.storage.local.remove(key);

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
