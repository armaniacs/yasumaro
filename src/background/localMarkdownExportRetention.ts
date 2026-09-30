/**
 * localMarkdownExportRetention.ts
 * VULN-004 (CWE-400/459): bound the growth of local Markdown auto-export.
 *
 * Three unbounded resources are addressed here:
 *  - the list of `chrome.downloads` records created by `flushBufferedExports`
 *    (capped at MAX_DOWNLOAD_RECORDS, oldest dropped)
 *  - old download records / files, removed once older than the retention window
 *  - the orphaned `local_export_YYYY-MM-DD` buffer keys those downloads leave
 *    behind (window: LOCAL_MARKDOWN_BUFFER_RETENTION_DAYS, swept from
 *    dailyPurgeHandler)
 *
 * Retention start point is the download creation time (`createdAt`), not the
 * file's calendar date. The buffer keys are the exception: they are named after
 * the day they hold, so their window is a calendar-day comparison.
 */

import { LogType } from '../utils/logger/types.js';
import { addLog } from '../utils/logger/core.js';
import { withOptimisticLock } from '../utils/storage/storageTransaction.js';

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

// Retention for the `local_export_YYYY-MM-DD` buffer keys, a resource separate
// from the download records above: a buffer key is orphaned whenever its
// download failed, or the export mode was 'manual' on that day, and nothing
// reclaims it at failure time on purpose (deleting there would drop that day's
// data — see the VULN-004 pin in localMarkdownExportCore.ts). Seven days keeps a
// week of unflushed days recoverable while bounding the orphan count that every
// flush's full-storage read has to load, and is deliberately not tied to
// LOCAL_MARKDOWN_EXPORT_RETENTION_DAYS: those measure different things, so
// tuning one must not silently change the other.
export const LOCAL_MARKDOWN_BUFFER_RETENTION_DAYS = 7;

export const LOCAL_EXPORT_DOWNLOAD_IDS_KEY = 'local_md_export_download_ids';

export interface DownloadRecord {
  downloadId: number;
  date: string;
  createdAt: number;
}

function toRecords(value: unknown): DownloadRecord[] {
  return Array.isArray(value) ? (value as DownloadRecord[]) : [];
}

async function readRecords(): Promise<DownloadRecord[]> {
  const stored = await chrome.storage.local.get(LOCAL_EXPORT_DOWNLOAD_IDS_KEY);
  return toRecords(stored[LOCAL_EXPORT_DOWNLOAD_IDS_KEY]);
}

/**
 * Append a generated download id, dropping the oldest records once the list
 * exceeds MAX_DOWNLOAD_RECORDS.
 *
 * The read, the append and the cap all run as one updater inside
 * withOptimisticLock: a raw get-then-set let a concurrent
 * purgeExpiredDownloadRecords write land in between, so the append landed on a
 * list that no longer had the entries the purge kept — and vice versa, the
 * purge could rewrite a list that predated this id and drop it. `createdAt` is
 * stamped before the lock so a CAS retry re-applies the same record instead of
 * re-reading the clock.
 */
export async function recordDownloadId(downloadId: number, date: string): Promise<void> {
  const record: DownloadRecord = { downloadId, date, createdAt: Date.now() };

  await withOptimisticLock<DownloadRecord[]>(LOCAL_EXPORT_DOWNLOAD_IDS_KEY, (current) => {
    const appended = [...toRecords(current), record];
    return appended.length > MAX_DOWNLOAD_RECORDS
      ? appended.slice(appended.length - MAX_DOWNLOAD_RECORDS)
      : appended;
  });
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
  const cutoff = Date.now() - LOCAL_MARKDOWN_EXPORT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  // Cheap pre-check so the daily no-op path does not take the lock (and bump
  // the list version) for nothing. Safe as a filter only: records are appended
  // with a current `createdAt`, so one missing from this read can never turn
  // out to be expired — a stale read can skip a purge until the next run, never
  // skip a write.
  if ((await readRecords()).every((r) => r.createdAt > cutoff)) return;

  // Claim the expired records by dropping them from the list inside the same
  // locked update, then run the chrome.downloads side effects OUTSIDE the lock.
  // Awaiting removeFile/erase inside the updater would hold the list's
  // serialization for the whole round trip, and — the actual lost update — a
  // flush's recordDownloadId landing in that window would be overwritten by a
  // kept-list computed before the await. Claiming first also means a concurrent
  // append can only add to the kept list, so a claimed record can never be
  // resurrected. The cost of claiming before erasing is that a crash in between
  // leaves the download entry in chrome://downloads forever, which is the
  // recoverable direction of that trade.
  let claimed: DownloadRecord[] = [];
  await withOptimisticLock<DownloadRecord[]>(LOCAL_EXPORT_DOWNLOAD_IDS_KEY, (current) => {
    const records = toRecords(current);
    // Recomputed from `current` on every CAS retry, so after the lock resolves
    // `claimed` always describes the list that was actually written.
    claimed = records.filter((r) => r.createdAt <= cutoff);
    return records.filter((r) => r.createdAt > cutoff);
  });

  for (const record of claimed) {
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
}
