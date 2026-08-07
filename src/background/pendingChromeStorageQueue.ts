/**
 * pendingChromeStorageQueue.ts
 * Holds chrome.storage.local writes that failed (e.g. quota exceeded,
 * transient storage error) so they aren't silently lost. Queued writes are
 * retried on the next flush (Service Worker startup / offline-network-retry
 * alarm) instead of being dropped (PBI-13 legacy dual-write path).
 *
 * Queue storage/enqueue mechanics are shared via StorageBackedQueue (PBI-09),
 * mirroring pendingSqliteQueue.ts's design for the chrome.storage side.
 */

import { addLog, LogType } from '../utils/logger.js';
import { StorageBackedQueue } from './storageBackedQueue.js';

export const PENDING_CHROME_STORAGE_KEY = 'pending_chrome_storage_writes';

/** Hard cap so a prolonged storage outage can't grow this list unbounded. */
const MAX_PENDING_WRITES = 500;

export interface PendingChromeStorageWrite {
  key: string;
  value: unknown;
  id?: number;
}

const queue = new StorageBackedQueue<PendingChromeStorageWrite>(
  PENDING_CHROME_STORAGE_KEY,
  MAX_PENDING_WRITES,
  'pendingChromeStorageQueue',
);

/**
 * Queue a chrome.storage.local write that failed. Best-effort: a queue
 * write failure is logged but not thrown, so it never masks the original
 * write failure.
 */
export async function enqueuePendingWrite(write: PendingChromeStorageWrite): Promise<void> {
  await queue.enqueue(write, { key: write.key });
}

/**
 * Retry every queued write. Writes that succeed are removed from the
 * queue; writes that fail stay queued for the next flush.
 * @param retryFn - Performs the actual retry; returns true on success.
 */
export async function flushPendingWrites(
  retryFn: (write: PendingChromeStorageWrite) => Promise<boolean>
): Promise<void> {
  const writes = await queue.load();
  if (writes.length === 0) return;

  const stillPending = await queue.flush(retryFn);

  if (stillPending.length < writes.length) {
    addLog(LogType.INFO, 'pendingChromeStorageQueue: flushed queued writes', {
      recovered: writes.length - stillPending.length,
      remaining: stillPending.length,
    });
  }
}
