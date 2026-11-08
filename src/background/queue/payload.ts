/**
 * queue/payload.ts
 * Payload size estimation shared by every PersistentRetryQueue-backed queue
 * (offlineNetworkQueue, pendingChromeStorageQueue, pendingSqliteQueue) so the
 * byte-size measurement itself is defined exactly once.
 */

/**
 * Estimate a payload's serialized size in bytes.
 *
 * PBI 2026-11-08-07(6): an unserializable (e.g. circular) payload must never
 * measure 0 bytes — 0 sails through every capacity gate and queues a job the
 * storage layer cannot persist. +Infinity trips the size gate instead, so the
 * caller drops the job through its normal "payload too large" path.
 */
export function estimatePayloadSize(payload: unknown): number {
  try {
    return new Blob([JSON.stringify(payload)]).size;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
