/**
 * pendingSqliteQueue.ts
 * Holds browsing-log records that failed to insert into SQLite (e.g. the
 * offscreen document was unreachable) so they aren't silently lost. Queued
 * records are retried on the next flush (Service Worker startup) instead
 * of being dropped (M14).
 */

import { addLog, LogType } from '../utils/logger.js';
import type { BrowsingLogRecord } from '../utils/sqlite-types.js';
import { PersistentRetryQueue, ChromeStorageAdapter } from './persistentRetryQueue.js';

export { chunkArray } from './persistentRetryQueue.js';

export const PENDING_SQLITE_RECORDS_KEY = 'pending_sqlite_records';

/** Hard cap so a prolonged SQLite outage can't grow this list unbounded. */
const MAX_PENDING_RECORDS = 500;

interface SqliteClientLike {
  mutate: (op: { type: 'insertBatch'; records: BrowsingLogRecord[] }) => Promise<{
    success: true;
    data: { count: number };
  } | {
    success: false;
    error: { kind: string; message: string; retriable: boolean };
  }>;
}

/** Number of records to insert in a single offscreen round-trip. */
const BATCH_SIZE = 50;

/** Maximum number of retries before a pending record is dropped. */
const MAX_RETRY_COUNT = 5;

/** Time-to-live for pending records (24 hours). */
const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Internal type: BrowsingLogRecord enriched with retry metadata.
 * Enqueued as this type; unwrapped to plain BrowsingLogRecord before SQLite insert.
 */
type QueuedRecord = BrowsingLogRecord & { createdAt: number; retryCount: number };

const adapter = new ChromeStorageAdapter();
const queue = new PersistentRetryQueue<QueuedRecord>(adapter, {
  storageKey: PENDING_SQLITE_RECORDS_KEY,
  maxSize: MAX_PENDING_RECORDS,
  logLabel: 'pendingSqliteQueue',
  maxRetryCount: MAX_RETRY_COUNT,
  ttlMs: TTL_MS,
});

/**
 * Queue a record that failed to insert into SQLite. Best-effort: a queue
 * write failure is logged but not thrown, so it never masks the original
 * insert failure.
 */
export async function enqueuePendingRecord(record: BrowsingLogRecord): Promise<void> {
  const queued: QueuedRecord = {
    ...record,
    createdAt: Date.now(),
    retryCount: 0,
  };
  await queue.enqueue(queued);
}

/**
 * Retry every queued record in chunks. Records from chunks that succeed
 * are removed from the queue; records from chunks that fail stay queued
 * for the next flush.
 */
export async function flushPendingRecords(sqliteClient: SqliteClientLike): Promise<void> {
  const totalBefore = await queue.getQueueSize();
  if (totalBefore === 0) return;

  await queue.flushBatch(async (items: QueuedRecord[]) => {
    // Unwrap metadata before passing to SQLite
    const records = items.map(({ createdAt: _c, retryCount: _r, ...rest }) => rest as BrowsingLogRecord);
    try {
      const result = await sqliteClient.mutate({ type: 'insertBatch', records });
      if (result.success) {
        return items.map(() => true);
      }
      return items.map(() => false);
    } catch {
      return items.map(() => false);
    }
  }, BATCH_SIZE);

  const totalAfter = await queue.getQueueSize();
  if (totalAfter < totalBefore) {
    addLog(LogType.INFO, 'pendingSqliteQueue: flushed queued records', {
      recovered: totalBefore - totalAfter,
      remaining: totalAfter,
    });
  }
}
