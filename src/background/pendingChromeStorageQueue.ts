/**
 * pendingChromeStorageQueue.ts
 * Holds chrome.storage.local writes that failed (e.g. quota exceeded,
 * transient storage error) so they aren't silently lost. Queued writes are
 * retried on the next flush (Service Worker startup / offline-network-retry
 * alarm) instead of being dropped. Mirrors pendingSqliteQueue.ts's design
 * for the chrome.storage side of the legacy dual-write path (PBI-13).
 */

import { addLog, LogType } from '../utils/logger.js';

export const PENDING_CHROME_STORAGE_KEY = 'pending_chrome_storage_writes';

/** Hard cap so a prolonged storage outage can't grow this list unbounded. */
const MAX_PENDING_WRITES = 500;

export interface PendingChromeStorageWrite {
  key: string;
  value: unknown;
  id?: number;
}

async function loadQueue(): Promise<PendingChromeStorageWrite[]> {
  const result = await chrome.storage.local.get(PENDING_CHROME_STORAGE_KEY);
  const stored = result[PENDING_CHROME_STORAGE_KEY];
  return Array.isArray(stored) ? (stored as PendingChromeStorageWrite[]) : [];
}

async function saveQueue(writes: PendingChromeStorageWrite[]): Promise<void> {
  await chrome.storage.local.set({ [PENDING_CHROME_STORAGE_KEY]: writes });
}

/**
 * Queue a chrome.storage.local write that failed. Best-effort: a queue
 * write failure is logged but not thrown, so it never masks the original
 * write failure.
 */
export async function enqueuePendingWrite(write: PendingChromeStorageWrite): Promise<void> {
  try {
    const queue = await loadQueue();
    queue.push(write);
    if (queue.length > MAX_PENDING_WRITES) {
      queue.splice(0, queue.length - MAX_PENDING_WRITES);
    }
    await saveQueue(queue);
  } catch (error) {
    addLog(LogType.ERROR, 'pendingChromeStorageQueue: failed to enqueue write', {
      key: write.key,
      error: String(error),
    });
  }
}

/**
 * Retry every queued write. Writes that succeed are removed from the
 * queue; writes that fail stay queued for the next flush.
 * @param retryFn - Performs the actual retry; returns true on success.
 */
export async function flushPendingWrites(
  retryFn: (write: PendingChromeStorageWrite) => Promise<boolean>
): Promise<void> {
  const queue = await loadQueue();
  if (queue.length === 0) return;

  const stillPending: PendingChromeStorageWrite[] = [];

  for (const write of queue) {
    try {
      const success = await retryFn(write);
      if (!success) {
        stillPending.push(write);
      }
    } catch {
      stillPending.push(write);
    }
  }

  await saveQueue(stillPending);

  if (stillPending.length < queue.length) {
    addLog(LogType.INFO, 'pendingChromeStorageQueue: flushed queued writes', {
      recovered: queue.length - stillPending.length,
      remaining: stillPending.length,
    });
  }
}
