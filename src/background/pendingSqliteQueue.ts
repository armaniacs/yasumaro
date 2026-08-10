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

export const PENDING_SQLITE_RECORDS_KEY = 'pending_sqlite_records';

/** Hard cap so a prolonged SQLite outage can't grow this list unbounded. */
const MAX_PENDING_RECORDS = 500;

interface SqliteClientLike {
  insertBatch(records: BrowsingLogRecord[]): Promise<{ count: number } | null>;
}

/** Number of records to insert in a single offscreen round-trip. */
const BATCH_SIZE = 50;

const adapter = new ChromeStorageAdapter();
const queue = new PersistentRetryQueue<BrowsingLogRecord>(adapter, {
  storageKey: PENDING_SQLITE_RECORDS_KEY,
  maxSize: MAX_PENDING_RECORDS,
  logLabel: 'pendingSqliteQueue',
});

/**
 * Queue a record that failed to insert into SQLite. Best-effort: a queue
 * write failure is logged but not thrown, so it never masks the original
 * insert failure.
 */
export async function enqueuePendingRecord(record: BrowsingLogRecord): Promise<void> {
  await queue.enqueue(record);
}

/**
 * Split an array into chunks of at most `size` items.
 * Exported for unit testing.
 */
export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Retry every queued record in chunks. Records from chunks that succeed
 * are removed from the queue; records from chunks that fail stay queued
 * for the next flush.
 */
export async function flushPendingRecords(sqliteClient: SqliteClientLike): Promise<void> {
  const records = await queue.load();
  if (records.length === 0) return;

  const stillPending: BrowsingLogRecord[] = [];
  const chunks = chunkArray(records, BATCH_SIZE);

  for (const chunk of chunks) {
    try {
      const result = await sqliteClient.insertBatch(chunk);
      if (!result) {
        stillPending.push(...chunk);
      }
    } catch {
      stillPending.push(...chunk);
    }
  }

  await queue.save(stillPending);

  if (stillPending.length < records.length) {
    addLog(LogType.INFO, 'pendingSqliteQueue: flushed queued records', {
      recovered: records.length - stillPending.length,
      remaining: stillPending.length,
    });
  }
}
