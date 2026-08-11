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
  createdAt: number;
  retryCount: number;
  contentOmitted?: boolean;
}

export type QueuedChromeStorageWrite = PendingChromeStorageWrite | PendingMetadataPatchWrite;

const adapter = new ChromeStorageAdapter();
const queue = new PersistentRetryQueue<QueuedChromeStorageWrite>(adapter, {
  storageKey: PENDING_CHROME_STORAGE_KEY,
  maxSize: MAX_PENDING_WRITES,
  logLabel: 'pendingChromeStorageQueue',
  maxPayloadBytes: 100 * 1024, // 100KB per metadata patch
  maxRetryCount: 5,
  ttlMs: 7 * 24 * 60 * 60 * 1000, // 7 days
});

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
export async function enqueuePendingWrite(write: QueuedChromeStorageWrite): Promise<void> {
  if ('type' in write && write.type === 'metadataPatch') {
    const existing = await queue.load();
    const sameUrlIndex = existing.findIndex(
      (w) => 'type' in w && (w as PendingMetadataPatchWrite).type === 'metadataPatch' && (w as PendingMetadataPatchWrite).url === write.url,
    );
    if (sameUrlIndex >= 0) {
      const existingPatch = existing[sameUrlIndex] as PendingMetadataPatchWrite;
      const mergedPatch = { ...existingPatch.patch, ...write.patch };
      if (write.mergeTags && existingPatch.mergeTags && existingPatch.patch.tags && write.patch.tags) {
        mergedPatch.tags = Array.from(new Set([...(existingPatch.patch.tags || []), ...(write.patch.tags || [])]));
      }
      const latestTimestamp = Math.max(existingPatch.timestamp || 0, write.timestamp || 0);
      existing[sameUrlIndex] = {
        ...existingPatch,
        patch: mergedPatch,
        timestamp: latestTimestamp,
        createdAt: existingPatch.createdAt,
        retryCount: 0,
      };
      // Omit content if the merged payload exceeds the limit.
      const mergedSize = new Blob([JSON.stringify(mergedPatch)]).size;
      const MAX_PATCH_PAYLOAD_BYTES = 100 * 1024;
      if (mergedSize > MAX_PATCH_PAYLOAD_BYTES && mergedPatch.content) {
        existing[sameUrlIndex] = {
          ...existing[sameUrlIndex],
          patch: (({ content, ...rest }: { content?: string }) => rest)(mergedPatch),
          contentOmitted: true,
        };
      }
      await queue.save(existing);
      return;
    }
  }

  // Omit content for new metadata patches that exceed the payload limit.
  let queuedWrite = write;
  if ('type' in write && write.type === 'metadataPatch') {
    const patch = (write as PendingMetadataPatchWrite).patch;
    const payloadSize = new Blob([JSON.stringify(patch)]).size;
    const MAX_PATCH_PAYLOAD_BYTES = 100 * 1024;
    if (payloadSize > MAX_PATCH_PAYLOAD_BYTES && patch.content) {
      queuedWrite = {
        ...write,
        patch: (({ content, ...rest }: { content?: string }) => rest)(patch),
        contentOmitted: true,
      } as PendingMetadataPatchWrite;
    }
  }
  await queue.enqueue(queuedWrite);
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
