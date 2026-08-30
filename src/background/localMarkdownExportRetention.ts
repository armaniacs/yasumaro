/**
 * localMarkdownExportRetention.ts
 * VULN-004 (CWE-400/459): bound the growth of local Markdown auto-export.
 *
 * Two unbounded resources are addressed here:
 *  - the list of `chrome.downloads` records created by `flushBufferedExports`
 *    (capped at MAX_DOWNLOAD_RECORDS, oldest dropped)
 *  - old download records / files, removed once older than the retention window
 *
 * Retention start point is the download creation time (`createdAt`), not the
 * file's calendar date.
 */

import { addLog, LogType } from '../utils/logger.js';

// Kept as a constant rather than a settings-UI knob: local Markdown export is an
// advanced feature with a fixed calendar-file layout, and a shorter/longer
// history window has no user-visible effect beyond `chrome://downloads` cleanup.
// Exposing it would add a setting most users never touch. Aligns with the
// 30-day BACKUP_RETENTION_DAYS precedent in storage/settingsMigration.ts.
export const LOCAL_MARKDOWN_EXPORT_RETENTION_DAYS = 30;

// Upper bound on the tracked download-id list so the record itself cannot grow
// without limit. 200 ~= LOCAL_MARKDOWN_EXPORT_RETENTION_DAYS worth of daily
// flushes plus headroom for the immediate/idle timings.
export const MAX_DOWNLOAD_RECORDS = 200;

export const LOCAL_EXPORT_DOWNLOAD_IDS_KEY = 'local_md_export_download_ids';

export interface DownloadRecord {
  downloadId: number;
  date: string;
  createdAt: number;
}

async function readRecords(): Promise<DownloadRecord[]> {
  const stored = await chrome.storage.local.get(LOCAL_EXPORT_DOWNLOAD_IDS_KEY);
  const value = stored[LOCAL_EXPORT_DOWNLOAD_IDS_KEY];
  return Array.isArray(value) ? (value as DownloadRecord[]) : [];
}

/**
 * Append a generated download id, dropping the oldest records once the list
 * exceeds MAX_DOWNLOAD_RECORDS.
 */
export async function recordDownloadId(downloadId: number, date: string): Promise<void> {
  const records = await readRecords();
  records.push({ downloadId, date, createdAt: Date.now() });

  const trimmed = records.length > MAX_DOWNLOAD_RECORDS
    ? records.slice(records.length - MAX_DOWNLOAD_RECORDS)
    : records;

  await chrome.storage.local.set({ [LOCAL_EXPORT_DOWNLOAD_IDS_KEY]: trimmed });
}

/**
 * Remove download records (and, best-effort, their files) older than
 * LOCAL_MARKDOWN_EXPORT_RETENTION_DAYS.
 *
 * `chrome.downloads.removeFile` fails if the user already moved/deleted the file
 * or the item is not `complete`; that failure is swallowed. The history-record
 * removal (`chrome.downloads.erase`, the actual API — the PBI's "removeDownload"
 * is not a real method name) is always attempted regardless.
 */
export async function purgeExpiredDownloadRecords(): Promise<void> {
  const records = await readRecords();
  if (records.length === 0) return;

  const cutoff = Date.now() - LOCAL_MARKDOWN_EXPORT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const expired = records.filter((r) => r.createdAt <= cutoff);
  if (expired.length === 0) return;

  for (const record of expired) {
    try {
      await chrome.downloads.removeFile(record.downloadId);
    } catch {
      // File already gone or not downloadable — harmless, still erase the record.
    }
    try {
      await chrome.downloads.erase({ id: record.downloadId });
    } catch (error: unknown) {
      addLog(LogType.ERROR, 'Local Markdown download record erase failed', {
        downloadId: record.downloadId,
        error: String(error),
      });
    }
  }

  const kept = records.filter((r) => r.createdAt > cutoff);
  await chrome.storage.local.set({ [LOCAL_EXPORT_DOWNLOAD_IDS_KEY]: kept });
}
