/**
 * localMarkdownExportRetention.ts
 * VULN-004 (CWE-400/459): bound the growth of local Markdown auto-export.
 *
 * Three unbounded resources are addressed here:
 *  - the list of `chrome.downloads` records created by `flushBufferedExports`
 *    (capped at MAX_DOWNLOAD_RECORDS; the oldest records the cap drops move to
 *    the erase queue, so the next purge erases their entries once they age out)
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
import { withOptimisticLock, withAtomicKeys } from '../utils/storage/storageTransaction.js';

// Kept as a constant rather than a settings-UI knob: local Markdown export is an
// advanced feature with a fixed calendar-file layout, and a shorter/longer
// history window has no user-visible effect beyond `chrome://downloads` cleanup.
// Exposing it would add a setting most users never touch. Aligns with the
// 30-day BACKUP_RETENTION_DAYS precedent in storage/settingsMigration.ts.
export const LOCAL_MARKDOWN_EXPORT_RETENTION_DAYS = 30;

// Upper bound on the tracked download-id list so the record itself cannot grow
// without limit. 200 ~= LOCAL_MARKDOWN_EXPORT_RETENTION_DAYS worth of daily
// flushes plus headroom for the immediate/idle timings. That is a usage
// estimate, not an enforced per-day cap: the immediate/idle timings are not
// limited to one flush per day, so the list can roll over well inside the
// retention window. A record the cap drops is therefore handed to the erase
// queue (LOCAL_EXPORT_ERASE_QUEUE_KEY, drained by purgeExpiredDownloadRecords)
// instead of silently vanishing from every deletion path. PBI 2026-10-18-21
// (audit fingerprint export-download-cap:oldest-drop-leaks-unerased-entries):
// adopted option 1 of the PBI, the pending-erase queue.
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

// Records the MAX_DOWNLOAD_RECORDS cap dropped wait here for the next purge,
// which erases them once they pass the retention cutoff (same filter as the
// tracked list, so nothing inside its 30-day window disappears early).
// Deliberately uncapped: an oldest-drop cap here would drop records the purge
// would otherwise have erased, i.e. the exact leak this queue exists to close,
// and the queue is bounded anyway. It only ever holds records already outside
// the 200-record list, so its size is the flush rate over the retention window,
// and every purge drains the records that have aged out. Additive key: rollback
// code never reads it, and a leftover queue is inert.
export const LOCAL_EXPORT_ERASE_QUEUE_KEY = 'local_md_export_erase_queue';

export interface DownloadRecord {
  downloadId: number;
  date: string;
  createdAt: number;
}

function toRecords(value: unknown): DownloadRecord[] {
  return Array.isArray(value) ? (value as DownloadRecord[]) : [];
}

async function readPending(): Promise<{ records: DownloadRecord[]; queued: DownloadRecord[] }> {
  const stored = await chrome.storage.local.get([LOCAL_EXPORT_DOWNLOAD_IDS_KEY, LOCAL_EXPORT_ERASE_QUEUE_KEY]);
  return {
    records: toRecords(stored[LOCAL_EXPORT_DOWNLOAD_IDS_KEY]),
    queued: toRecords(stored[LOCAL_EXPORT_ERASE_QUEUE_KEY]),
  };
}

/**
 * Best-effort delete of one download record: `chrome.downloads.removeFile`
 * fails if the user already moved/deleted the file or the item is not
 * `complete`; that failure is swallowed. The history-record removal
 * (`chrome.downloads.erase`, the actual API — the PBI's "removeDownload" is not
 * a real method name) is always attempted regardless. Returns whether the
 * history record was actually erased, so the erase queue only claims records
 * that were.
 */
async function eraseDownloadRecord(record: DownloadRecord): Promise<boolean> {
  try {
    await chrome.downloads.removeFile(record.downloadId);
  } catch {
    // File already gone or not downloadable — harmless, still erase the record.
  }
  try {
    await chrome.downloads.erase({ id: record.downloadId });
    return true;
  } catch (error: unknown) {
    addLog(LogType.ERROR, 'Local Markdown download record erase failed', {
      downloadId: record.downloadId,
      error: String(error),
    });
    return false;
  }
}

/**
 * Identity of one queued record. The erase queue's claim matches the exact
 * records this run erased (downloadId + date + createdAt) so it can never
 * remove a record a concurrent cap-drop appended after the erase read.
 */
function queueEntryKey(record: DownloadRecord): string {
  return `${record.downloadId}:${record.date}:${record.createdAt}`;
}

/**
 * Append a generated download id, dropping the oldest records once the list
 * exceeds MAX_DOWNLOAD_RECORDS.
 *
 * The read, the append and the cap all run as one updater, and the records the
 * cap drops land in the erase queue in the SAME update: withAtomicKeys covers
 * the list and the queue together, so a cap-drop can never remove records from
 * the list without persisting them where the purge can see them. Dropping them
 * from the list alone would make them invisible to
 * purgeExpiredDownloadRecords' claim filter — no path would ever reach
 * chrome.downloads.removeFile/erase and their chrome://downloads entries would
 * outlive the retention window (PBI 2026-10-18-21).
 *
 * The CAS discipline is unchanged from the single-key withOptimisticLock this
 * used before: a raw get-then-set let a concurrent purgeExpiredDownloadRecords
 * write land in between, so the append landed on a list that no longer had the
 * entries the purge kept — and vice versa, the purge could rewrite a list that
 * predated this id and drop it. `createdAt` is stamped before the lock so a CAS
 * retry re-applies the same record instead of re-reading the clock.
 */
export async function recordDownloadId(downloadId: number, date: string): Promise<void> {
  const record: DownloadRecord = { downloadId, date, createdAt: Date.now() };

  await withAtomicKeys<[DownloadRecord[], DownloadRecord[]]>(
    [LOCAL_EXPORT_DOWNLOAD_IDS_KEY, LOCAL_EXPORT_ERASE_QUEUE_KEY],
    ([records, queued]) => {
      const appended = [...toRecords(records), record];
      const kept =
        appended.length > MAX_DOWNLOAD_RECORDS
          ? appended.slice(appended.length - MAX_DOWNLOAD_RECORDS)
          : appended;
      const dropped = appended.slice(0, appended.length - kept.length);
      return [kept, [...toRecords(queued), ...dropped]];
    },
  );
}

/**
 * Remove download records (and, best-effort, their files) older than
 * LOCAL_MARKDOWN_EXPORT_RETENTION_DAYS, from the tracked list and from the
 * erase queue the cap drops records into (PBI 2026-10-18-21).
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
  // with a current `createdAt`, and a cap-drop carries its original stamp into
  // the erase queue, so a record missing from this read can never turn out to
  // be expired — a stale read can skip a purge until the next run, never skip
  // a write.
  const pending = await readPending();
  if (
    pending.records.every((r) => r.createdAt > cutoff) &&
    pending.queued.every((r) => r.createdAt > cutoff)
  ) {
    return;
  }

  // Claim the expired records by dropping them from the list inside the same
  // locked update, then run the chrome.downloads side effects OUTSIDE the lock.
  // Awaiting removeFile/erase inside the updater would hold the list's
  // serialization for the whole round trip, and — the actual lost update — a
  // flush's recordDownloadId landing in that window would be overwritten by a
  // kept-list computed before the await. Claiming first also means a concurrent
  // append can only add to the kept list, so a claimed record can never be
  // resurrected. The cost of claiming before erasing is that a crash in between
  // leaves the download entry in chrome://downloads forever, which is the
  // recoverable direction of that trade. The erase queue below does not change
  // that: it only holds records the cap dropped, so a claim lost to a crash
  // here still has nothing left tracking it.
  //
  // Skipped when this read saw no expired list records: list appends are always
  // stamped with a current `createdAt` and a cap-drop moves expired records to
  // the erase queue (never back into the list), so no expired record can appear
  // between the read and the claim. Skipping keeps a queue-only drain from
  // bumping the list version for nothing.
  if (pending.records.some((r) => r.createdAt <= cutoff)) {
    let claimed: DownloadRecord[] = [];
    await withOptimisticLock<DownloadRecord[]>(LOCAL_EXPORT_DOWNLOAD_IDS_KEY, (current) => {
      const records = toRecords(current);
      // Recomputed from `current` on every CAS retry, so after the lock resolves
      // `claimed` always describes the list that was actually written.
      claimed = records.filter((r) => r.createdAt <= cutoff);
      return records.filter((r) => r.createdAt > cutoff);
    });

    for (const record of claimed) {
      await eraseDownloadRecord(record);
    }
  }

  // Drain the erase queue in the opposite order — erase first, claim after.
  // Its claim matches the exact records THIS run erased (queueEntryKey), so a
  // record a concurrent cap-drop appended after the read can never be claimed
  // without an erase, and a crash between the erase and the claim leaves the
  // queue intact: the next purge retries the erase (removeFile rejects on a
  // gone item, erase resolves empty — both harmless) and claims then. Claiming
  // first, like the list above does, would instead drop the record on that
  // crash with no tracking left to erase it, and an erase failure would lose
  // the retry — the queue keeps a failed record for the next run.
  const expiredQueued = pending.queued.filter((r) => r.createdAt <= cutoff);
  const erased: DownloadRecord[] = [];
  for (const record of expiredQueued) {
    if (await eraseDownloadRecord(record)) erased.push(record);
  }
  if (erased.length > 0) {
    await withOptimisticLock<DownloadRecord[]>(LOCAL_EXPORT_ERASE_QUEUE_KEY, (current) => {
      const erasedKeys = new Set(erased.map(queueEntryKey));
      // Recomputed from `current` on every CAS retry: a record appended
      // concurrently is not in `erasedKeys` and survives the claim.
      return toRecords(current).filter((r) => !erasedKeys.has(queueEntryKey(r)));
    });
  }
}
