/**
 * pendingSqliteQueue.ts
 * Holds browsing-log records that failed to insert into SQLite (e.g. the
 * offscreen document was unreachable) so they aren't silently lost. Queued
 * records are retried on the next flush (Service Worker startup) instead
 * of being dropped (M14).
 */

import { addLog, LogType } from '../utils/logger.js';
import type { BrowsingLogRecord } from '../utils/sqlite-types.js';

export const PENDING_SQLITE_RECORDS_KEY = 'pending_sqlite_records';

/** Hard cap so a prolonged SQLite outage can't grow this list unbounded. */
const MAX_PENDING_RECORDS = 500;

interface SqliteClientLike {
  insert(record: BrowsingLogRecord): Promise<{ id: number } | null>;
}

async function loadQueue(): Promise<BrowsingLogRecord[]> {
  const result = await chrome.storage.local.get(PENDING_SQLITE_RECORDS_KEY);
  const stored = result[PENDING_SQLITE_RECORDS_KEY];
  return Array.isArray(stored) ? (stored as BrowsingLogRecord[]) : [];
}

async function saveQueue(records: BrowsingLogRecord[]): Promise<void> {
  await chrome.storage.local.set({ [PENDING_SQLITE_RECORDS_KEY]: records });
}

/**
 * Queue a record that failed to insert into SQLite. Best-effort: a queue
 * write failure is logged but not thrown, so it never masks the original
 * insert failure.
 */
export async function enqueuePendingRecord(record: BrowsingLogRecord): Promise<void> {
  try {
    const queue = await loadQueue();
    queue.push(record);
    if (queue.length > MAX_PENDING_RECORDS) {
      queue.splice(0, queue.length - MAX_PENDING_RECORDS);
    }
    await saveQueue(queue);
  } catch (error) {
    addLog(LogType.ERROR, 'pendingSqliteQueue: failed to enqueue record', {
      url: record.url,
      error: String(error),
    });
  }
}

/**
 * Retry every queued record. Records that succeed are removed from the
 * queue; records that fail again stay queued for the next flush.
 */
export async function flushPendingRecords(sqliteClient: SqliteClientLike): Promise<void> {
  const queue = await loadQueue();
  if (queue.length === 0) return;

  const stillPending: BrowsingLogRecord[] = [];
  for (const record of queue) {
    try {
      const result = await sqliteClient.insert(record);
      if (!result) {
        stillPending.push(record);
      }
    } catch {
      stillPending.push(record);
    }
  }

  await saveQueue(stillPending);

  if (stillPending.length < queue.length) {
    addLog(LogType.INFO, 'pendingSqliteQueue: flushed queued records', {
      recovered: queue.length - stillPending.length,
      remaining: stillPending.length,
    });
  }
}
