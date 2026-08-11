/**
 * pendingChromeStorageQueue.ts
 * Holds chrome.storage.local writes that failed (e.g. quota exceeded,
 * transient storage error) so they aren't silently lost. Queued writes are
 * retried on the next flush (Service Worker startup / offline-network-retry
 * alarm) instead of being dropped (PBI-13 legacy dual-write path).
 */

import { addLog, LogType } from '../utils/logger.js';
import { PersistentRetryQueue, ChromeStorageAdapter } from './persistentRetryQueue.js';
import type { SavedUrlEntryMetadataPatch } from '../utils/storage/savedUrlStore.js';

export const PENDING_CHROME_STORAGE_KEY = 'pending_chrome_storage_writes';

/** Hard cap so a prolonged storage outage can't grow this list unbounded. */
const MAX_PENDING_WRITES = 500;

/**
 * Legacy payload: a raw chrome.storage write that failed. Kept so payloads
 * already queued by older versions are still understood by the retry handler.
 */
export interface PendingChromeStorageWrite {
  key: string;
  value: unknown;
  id?: number;
}

/**
 * Metadata-patch payload: replays a failed saveSavedUrlEntryMetadata call.
 * Discriminated from the legacy payload by `type: 'metadataPatch'` so the
 * retry handler can route each shape without guessing.
 */
export interface PendingMetadataPatchWrite {
  type: 'metadataPatch';
  key: 'savedUrlsWithTimestamps';
  url: string;
  patch: SavedUrlEntryMetadataPatch;
  refreshTimestamp?: boolean;
  timestamp?: number;
  mergeTags?: boolean;
  id?: number;
}

export type QueuedChromeStorageWrite = PendingChromeStorageWrite | PendingMetadataPatchWrite;

const adapter = new ChromeStorageAdapter();
const queue = new PersistentRetryQueue<QueuedChromeStorageWrite>(adapter, {
  storageKey: PENDING_CHROME_STORAGE_KEY,
  maxSize: MAX_PENDING_WRITES,
  logLabel: 'pendingChromeStorageQueue',
});

/**
 * Queue a chrome.storage.local write that failed. Best-effort: a queue
 * write failure is logged but not thrown, so it never masks the original
 * write failure.
 */
export async function enqueuePendingWrite(write: QueuedChromeStorageWrite): Promise<void> {
  await queue.enqueue(write);
}

/**
 * Retry every queued write. Writes that succeed are removed from the
 * queue; writes that fail stay queued for the next flush.
 * @param retryFn - Performs the actual retry; returns true on success.
 */
export async function flushPendingWrites(
  retryFn: (write: QueuedChromeStorageWrite) => Promise<boolean>
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
