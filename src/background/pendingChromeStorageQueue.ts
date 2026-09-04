/**
 * pendingChromeStorageQueue.ts
 * Holds chrome.storage.local writes that failed (e.g. quota exceeded,
 * transient storage error) so they aren't silently lost. Queued writes are
 * retried on the next flush (Service Worker startup / offline-network-retry
 * alarm) instead of being dropped (PBI-13 legacy dual-write path).
 */

import { addLog, LogType } from '../utils/logger.js';
import { PersistentRetryQueue, ChromeStorageAdapter } from './persistentRetryQueue.js';
import {
  MAX_PATCH_PAYLOAD_BYTES,
  MAX_PENDING_WRITES,
  coalesceMetadataPatch,
  isMetadataPatchWrite,
} from './pendingPatchPolicy.js';
import type { SavedUrlEntryMetadataPatch } from '../utils/storage/savedUrlRepository.js';

export const PENDING_CHROME_STORAGE_KEY = 'pending_chrome_storage_writes';

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
  createdAt: number;
  retryCount: number;
  contentOmitted?: boolean;
  tagsOmitted?: boolean;
}

export type QueuedChromeStorageWrite = PendingChromeStorageWrite | PendingMetadataPatchWrite;

/**
 * Create a pending write queue with the given adapter.
 * The default export uses ChromeStorageAdapter; tests can inject InMemoryAdapter.
 */
export function createPendingWriteQueue(adapter: ChromeStorageAdapter) {
  const queue = new PersistentRetryQueue<QueuedChromeStorageWrite>(adapter, {
    storageKey: PENDING_CHROME_STORAGE_KEY,
    maxSize: MAX_PENDING_WRITES,
    logLabel: 'pendingChromeStorageQueue',
    maxPayloadBytes: MAX_PATCH_PAYLOAD_BYTES,
    maxRetryCount: 5,
    ttlMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  return {
    async enqueuePendingWrite(write: QueuedChromeStorageWrite): Promise<void> {
      // Metadata patches coalesce by URL inside the queue lock (mutate) —
      // never as a load()/save() pair, which races flush by construction
      // (VULN-056). Plain writes keep the capped enqueue path.
      if (isMetadataPatchWrite(write)) {
        await queue.mutate((writes) => coalesceMetadataPatch(writes, write));
        return;
      }
      await queue.enqueue(write);
    },

    async flushPendingWrites(
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
    },
  };
}

/**
 * Module-scoped queue instance used by the enqueuePendingWrite/flushPendingWrites
 * exports below. Built lazily (not at import time) so createBackgroundServices
 * controls when the ChromeStorageAdapter is constructed, and tests can swap in
 * an InMemoryAdapter via setPendingWriteQueue before any write happens.
 */
let activeQueue: ReturnType<typeof createPendingWriteQueue> | undefined;

function getActiveQueue(): ReturnType<typeof createPendingWriteQueue> {
  if (!activeQueue) {
    activeQueue = createPendingWriteQueue(new ChromeStorageAdapter());
  }
  return activeQueue;
}

/**
 * Inject the queue used by enqueuePendingWrite/flushPendingWrites. Production
 * code calls this once from createBackgroundServices; tests call it with a
 * queue built from InMemoryAdapter to avoid touching chrome.storage.
 */
export function setPendingWriteQueue(queue: ReturnType<typeof createPendingWriteQueue>): void {
  activeQueue = queue;
}

/**
 * Queue a chrome.storage.local write that failed. Best-effort: a queue
 * write failure is logged but not thrown, so it never masks the original
 * write failure.
 *
 * Metadata patches are coalesced by URL: when an existing patch for the
 * same URL is already queued, the two patches are merged (latest timestamp
 * wins, tags are combined when mergeTags is enabled) instead of appending
 * a duplicate entry.
 */
export function enqueuePendingWrite(write: QueuedChromeStorageWrite): Promise<void> {
  return getActiveQueue().enqueuePendingWrite(write);
}

/**
 * Retry every queued write. Writes that succeed are removed from the
 * queue; writes that fail stay queued for the next flush.
 * @param retryFn - Performs the actual retry; returns true on success.
 */
export function flushPendingWrites(
  retryFn: (write: QueuedChromeStorageWrite) => Promise<boolean>
): Promise<void> {
  return getActiveQueue().flushPendingWrites(retryFn);
}
