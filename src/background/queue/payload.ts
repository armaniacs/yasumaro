/**
 * queue/payload.ts
 * Payload size estimation shared by every PersistentRetryQueue-backed queue
 * (offlineNetworkQueue, pendingChromeStorageQueue, pendingSqliteQueue) so the
 * byte-size measurement itself is defined exactly once.
 */

/**
 * Estimate a payload's serialized size in bytes. Falls back to 0 on
 * circular/unserializable payloads so a measurement failure never blocks
 * enqueue — the caller's own drop/truncate policy decides what happens next.
 */
export function estimatePayloadSize(payload: unknown): number {
  try {
    return new Blob([JSON.stringify(payload)]).size;
  } catch {
    return 0;
  }
}
