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
 * Every deletion the purge runs is gated by an identity re-check: a recorded
 * downloadId is erased only while chrome.downloads still resolves it to the
 * recorded file (PBI 2026-10-18-22, audit fingerprint
 * export-purge-erase:stale-session-download-id-dereference).
 *
 * Retention start point is the download creation time (`createdAt`), not the
 * file's calendar date. The buffer keys are the exception: they are named after
 * the day they hold, so their window is a calendar-day comparison.
 */

import { LogType } from '../utils/logger/types.js';
import { addLog } from '../utils/logger/core.js';
import { errorMessage } from '../utils/errorUtils.js';
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
  /**
   * Item-identity info stamped at download time (PBI 2026-10-18-22): the
   * relative filename the flush passed to chrome.downloads.download().
   * DownloadItem.filename is the absolute local path with platform separators,
   * so the identity re-check suffix-matches this against the item's normalized
   * path. Records written before the re-check existed carry no filename and
   * fall back to the startTime criterion - old records are re-verified through
   * the same checkpoint, never permanently un-erasable.
   */
  filename?: string;
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

// How far the recorded `createdAt` stamp and the download's `startTime` may
// drift and still describe the same download (PBI 2026-10-18-22). The stamp is
// taken right after chrome.downloads.download resolves, so a fresh auto-export
// download differs by milliseconds and this only covers service-worker
// scheduling. A rebound id resolves to a download that began at least
// LOCAL_MARKDOWN_EXPORT_RETENTION_DAYS after the record was stamped, orders of
// magnitude beyond this tolerance, so the time criterion alone rejects it.
const DOWNLOAD_START_TIME_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Verdict of the identity re-check: 'verified' when the id still refers to the
 * recorded download, 'mismatch' when a criterion conclusively fails (item
 * gone, different file, different start time), 'search-failed' when the
 * verification could not run. Only 'verified' may reach a deletion call.
 */
type DownloadIdentityCheck = 'verified' | 'mismatch' | 'search-failed';

/**
 * Whether `itemPath` is the recorded filename. DownloadItem.filename is the
 * absolute local path with platform separators, while the record holds the
 * relative path the flush passed to download(), so normalize separators and
 * require a path-separator boundary around the recorded path (not a bare
 * suffix, which would let a same-tailed sibling directory match).
 */
function matchesRecordedPath(itemPath: string, recorded: string): boolean {
  const normalized = itemPath.replace(/\\/g, '/');
  return normalized === recorded || normalized.endsWith(`/${recorded}`);
}

/**
 * Re-check that `record.downloadId` still refers to the download this record
 * describes, BEFORE any deletion side effect (PBI 2026-10-18-22, audit
 * fingerprint export-purge-erase:stale-session-download-id-dereference).
 *
 * chrome.downloads ids are only guaranteed within a browser session, so a
 * record read after a browser restart can carry an id the platform re-assigned
 * to an unrelated download; erasing on it would delete a file this extension
 * never created. Every available criterion must hold: the item's path ends
 * with the recorded filename (records the current flush writes carry one), and
 * the download began when the record was stamped (DownloadItem.startTime vs
 * createdAt) - the only criterion old records without a filename have. A
 * rebound id resolves to a download that started at least a retention window
 * after the record was stamped, so the time criterion alone already rejects it.
 *
 * Search failure and item mismatch are logged as separate events so a skipped
 * purge can be triaged; both leave the chrome://downloads entry untouched for
 * the user to inspect and delete by hand.
 */
async function verifyDownloadIdentity(record: DownloadRecord): Promise<DownloadIdentityCheck> {
  let items: chrome.downloads.DownloadItem[];
  try {
    items = await chrome.downloads.search({ id: record.downloadId });
  } catch (error: unknown) {
    addLog(LogType.WARN, 'Local Markdown download identity search failed', {
      downloadId: record.downloadId,
      error: errorMessage(error),
    });
    return 'search-failed';
  }

  const item = items[0];
  if (!item) {
    addLog(LogType.WARN, 'Local Markdown download identity mismatch', {
      downloadId: record.downloadId,
      reason: 'not-found',
    });
    return 'mismatch';
  }

  if (record.filename !== undefined && !matchesRecordedPath(item.filename, record.filename)) {
    addLog(LogType.WARN, 'Local Markdown download identity mismatch', {
      downloadId: record.downloadId,
      reason: 'path-mismatch',
      filename: item.filename,
    });
    return 'mismatch';
  }

  const startedAt = Date.parse(item.startTime);
  if (
    !Number.isFinite(startedAt) ||
    Math.abs(startedAt - record.createdAt) > DOWNLOAD_START_TIME_TOLERANCE_MS
  ) {
    addLog(LogType.WARN, 'Local Markdown download identity mismatch', {
      downloadId: record.downloadId,
      reason: 'start-time-mismatch',
      startTime: item.startTime,
    });
    return 'mismatch';
  }

  return 'verified';
}

/**
 * What one erase attempt settled on:
 *  - 'erased': identity verified and the history record was erased
 *  - 'mismatch': the identity re-check conclusively showed the id no longer
 *    refers to the recorded download - nothing may ever be erased for it, so
 *    the erase queue claims the record and leaves the (unrelated)
 *    chrome://downloads entry to the user
 *  - 'search-failed': the identity re-check could not run - nothing erased and
 *    the record still owes an erase, so the erase queue keeps it for the next
 *    purge to re-check
 *  - 'erase-failed': identity verified but the erase API rejected - kept for
 *    retry, unchanged from before the identity check
 */
type EraseRecordOutcome = 'erased' | 'mismatch' | 'search-failed' | 'erase-failed';

/**
 * Best-effort delete of one download record, gated by an identity re-check:
 * `chrome.downloads.search({ id })` must still resolve `downloadId` to the
 * recorded download before either deletion call runs (PBI 2026-10-18-22, audit
 * fingerprint export-purge-erase:stale-session-download-id-dereference). The
 * tracked list and the erase queue share this one checkpoint.
 *
 * `chrome.downloads.removeFile` fails if the user already moved/deleted the
 * file or the item is not `complete`; that failure is swallowed. The
 * history-record removal (`chrome.downloads.erase`, the actual API - the PBI's
 * "removeDownload" is not a real method name) runs only after the re-check
 * passes, and its failure keeps the record queued for a retry.
 */
async function eraseDownloadRecord(record: DownloadRecord): Promise<EraseRecordOutcome> {
  const identity = await verifyDownloadIdentity(record);
  if (identity !== 'verified') return identity;
  try {
    await chrome.downloads.removeFile(record.downloadId);
  } catch {
    // File already gone or not downloadable — harmless, still erase the record.
  }
  try {
    await chrome.downloads.erase({ id: record.downloadId });
    return 'erased';
  } catch (error: unknown) {
    addLog(LogType.ERROR, 'Local Markdown download record erase failed', {
      downloadId: record.downloadId,
      error: errorMessage(error),
    });
    return 'erase-failed';
  }
}

/**
 * Identity of one queued record. The erase queue's claim matches the exact
 * records this run erased or conclusively identified as not ours (downloadId +
 * date + createdAt), so it can never remove a record a concurrent cap-drop
 * appended after the erase read, and never drops a record that still owes an
 * erase (a search failure or an erase rejection stays queued).
 */
function queueEntryKey(record: DownloadRecord): string {
  return `${record.downloadId}:${record.date}:${record.createdAt}`;
}

/**
 * Append a generated download id, dropping the oldest records once the list
 * exceeds MAX_DOWNLOAD_RECORDS.
 *
 * `filename` is the relative path the flush passed to chrome.downloads.download
 * (PBI 2026-10-18-22): the item-identity info the purge's re-check matches the
 * chrome.downloads item against before erasing. Records written without one
 * (the pre-PBI format) are verified through the startTime criterion instead -
 * old records fall back, they are not permanently un-erasable.
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
export async function recordDownloadId(downloadId: number, date: string, filename?: string): Promise<void> {
  const record: DownloadRecord =
    filename === undefined
      ? { downloadId, date, createdAt: Date.now() }
      : { downloadId, date, createdAt: Date.now(), filename };

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
 * Every record passes eraseDownloadRecord's identity re-check before any
 * deletion side effect (PBI 2026-10-18-22): the tracked list and the queue
 * share one checkpoint, and a record the re-check cannot confirm is never
 * erased - its chrome://downloads entry is left for the user to delete by
 * hand, and the skip is logged as its own event.
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
  // kept-list computed before the await. The identity re-check
  // (eraseDownloadRecord) is part of those side effects: a
  // chrome.downloads.search inside the updater would hold the serialization
  // the same way. Claiming first also means a concurrent append can only add
  // to the kept list, so a claimed record can never be resurrected. The cost
  // of claiming before erasing is that a crash in between leaves the download
  // entry in chrome://downloads forever, which is the recoverable direction of
  // that trade — and a record whose identity re-check cannot confirm it is
  // never erased, leaving the entry for the user by design (PBI
  // 2026-10-18-22). The erase queue below does not change that: it only holds
  // records the cap dropped, so a claim lost to a crash here still has
  // nothing left tracking it.
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
  // The claim matches the records THIS run settled (queueEntryKey): erased, or
  // conclusively identified as not ours — a mismatched record can never owe an
  // erase again, so keeping it would only re-run the same re-check every
  // purge. Records still owing an erase (search failed, or erase rejected)
  // stay queued. A record a concurrent cap-drop appended after the read can
  // never be claimed without an erase-or-mismatch, and a crash between the
  // erase and the claim leaves the queue intact: the next purge retries the
  // erase (removeFile rejects on a gone item, erase resolves empty — both
  // harmless) and claims then. Claiming first, like the list above does,
  // would instead drop the record on that crash with no tracking left to
  // erase it, and an erase failure would lose the retry — the queue keeps a
  // failed record for the next run.
  const expiredQueued = pending.queued.filter((r) => r.createdAt <= cutoff);
  const settled: DownloadRecord[] = [];
  for (const record of expiredQueued) {
    const outcome = await eraseDownloadRecord(record);
    if (outcome === 'erased' || outcome === 'mismatch') settled.push(record);
  }
  if (settled.length > 0) {
    await withOptimisticLock<DownloadRecord[]>(LOCAL_EXPORT_ERASE_QUEUE_KEY, (current) => {
      const settledKeys = new Set(settled.map(queueEntryKey));
      // Recomputed from `current` on every CAS retry: a record appended
      // concurrently is not in `settledKeys` and survives the claim.
      return toRecords(current).filter((r) => !settledKeys.has(queueEntryKey(r)));
    });
  }
}
