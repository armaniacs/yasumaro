/**
 * localMarkdownIdleFlusher.ts
 * PBI 2026-07-09-03: Defer local Markdown export to idle / periodic flush.
 *
 * saveLocalMarkdownStep only buffers entries per day in chrome.storage.local.
 * This module performs the actual chrome.downloads.download once, either when
 * the browser becomes idle (chrome.idle) or via a periodic fallback alarm
 * (always-active machines may never emit 'idle').
 */

import { getSettings, StorageKeys } from '../utils/storage.js';
import { addLog, LogType } from '../utils/logger.js';
import { DAILY_BUFFER_PREFIX, buildDailyMarkdown } from './pipeline/steps/saveLocalMarkdownStep.js';

const FLUSH_ALARM = 'yasumaro-local-md-flush';
const FLUSH_INTERVAL_MIN = 30;

/**
 * Download each buffered day's Markdown exactly once.
 * Skips when auto export is disabled (buffers stay empty in that case anyway).
 */
export async function flushPendingExports(): Promise<void> {
  try {
    const settings = await getSettings();
    if (!settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_AUTO_ENABLED]) return;

    const all = await chrome.storage.local.get();
    const exportPath = (settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH] as string) || 'Yasumaro';

    for (const key of Object.keys(all)) {
      if (!key.startsWith(DAILY_BUFFER_PREFIX)) continue;
      const entries = all[key];
      if (!Array.isArray(entries) || entries.length === 0) continue;

      const date = key.slice(DAILY_BUFFER_PREFIX.length);
      const content = buildDailyMarkdown(date, entries);
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
    }
  } catch (error: unknown) {
    addLog(LogType.ERROR, 'Local Markdown idle flush failed', { error: String(error) });
  }
}

/**
 * Wire idle detection and a periodic fallback alarm.
 * Safe to call on every Service Worker startup.
 */
export function initIdleFlush(): void {
  // Fallback for always-active machines: flush periodically.
  chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: FLUSH_INTERVAL_MIN });

  if (chrome.idle) {
    chrome.idle.onStateChanged.addListener((state) => {
      if (state === 'idle') void flushPendingExports();
    });
  }
}
