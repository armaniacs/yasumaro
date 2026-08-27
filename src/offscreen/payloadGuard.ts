/**
 * payloadGuard.ts
 * Common payload size guard for offscreen SQLite messages.
 * Centralizes the 1 MB field cap, batch limits, and restore size cap
 * that were previously scattered across individual switch cases.
 */

import type { SqliteMessage } from '../messaging/sqliteMessages.js';

/** Per-field cap for large text fields (summary/content/title). */
export const MAX_PAYLOAD_STRING_BYTES = 1024 * 1024; // 1 MB

/** Maximum records per INSERT_BATCH. */
export const MAX_BATCH_RECORDS = 2000;

/** Total bytes of text across a batch (sum of summary/content/title). */
export const MAX_BATCH_TOTAL_BYTES = 20 * 1024 * 1024; // 20 MB

/** Maximum bytes for RESTORE binary payload. */
export const MAX_RESTORE_BYTES = 100 * 1024 * 1024; // 100 MB

export interface PayloadLimits {
  maxStringBytes: number;
  maxBatchRecords: number;
  maxBatchTotalBytes: number;
  maxRestoreBytes: number;
}

export const DEFAULT_PAYLOAD_LIMITS: PayloadLimits = {
  maxStringBytes: MAX_PAYLOAD_STRING_BYTES,
  maxBatchRecords: MAX_BATCH_RECORDS,
  maxBatchTotalBytes: MAX_BATCH_TOTAL_BYTES,
  maxRestoreBytes: MAX_RESTORE_BYTES,
};

function getByteLength(value: string): number {
  // TextEncoder is available in browsers, service workers, offscreen documents, and modern Node.
  // Fallback to Blob.size for environments where TextEncoder is unavailable.
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).byteLength;
  }
  try {
    // Blob counts UTF-8 bytes when constructed from a string
    if (typeof Blob !== 'undefined') {
      return new Blob([value]).size;
    }
  } catch {
    // fall through
  }
  // Last resort: fallback to character count (underestimates for multibyte, but avoids crash)
  return value.length;
}

function stringExceeds(value: unknown, limit: number): boolean {
  return typeof value === 'string' && getByteLength(value) > limit;
}

/**
 * Validate payload size for a SQLite message.
 * Returns an error string when the payload exceeds limits, otherwise null.
 * Pure function — no side effects, no I/O.
 */
export function assertPayloadSize(
  msg: SqliteMessage,
  limits: PayloadLimits = DEFAULT_PAYLOAD_LIMITS,
): string | null {
  switch (msg.type) {
    case 'SQLITE_INSERT': {
      const payload = msg.payload as Record<string, unknown>;
      if (stringExceeds(payload.summary, limits.maxStringBytes)) {
        return 'Payload too large: summary exceeds 1MB limit';
      }
      if (stringExceeds(payload.content, limits.maxStringBytes)) {
        return 'Payload too large: content exceeds 1MB limit';
      }
      if (stringExceeds(payload.title, limits.maxStringBytes)) {
        return 'Payload too large: title exceeds 1MB limit';
      }
      return null;
    }
    case 'SQLITE_INSERT_BATCH': {
      const rawRecords = (msg.payload as { records?: unknown }).records;
      if (!Array.isArray(rawRecords)) {
        return `Payload too large: maximum ${limits.maxBatchRecords} records per batch`;
      }
      if (rawRecords.length > limits.maxBatchRecords) {
        return `Payload too large: maximum ${limits.maxBatchRecords} records per batch`;
      }
      let totalBytes = 0;
      for (const r of rawRecords) {
        if (!r || typeof r !== 'object') continue;
        const rec = r as Record<string, unknown>;
        // Per-record field cap — fail fast on any oversized field
        if (stringExceeds(rec.summary, limits.maxStringBytes)) {
          return 'Payload too large: summary exceeds 1MB limit';
        }
        if (stringExceeds(rec.content, limits.maxStringBytes)) {
          return 'Payload too large: content exceeds 1MB limit';
        }
        if (stringExceeds(rec.title, limits.maxStringBytes)) {
          return 'Payload too large: title exceeds 1MB limit';
        }
        // Accumulate total text size for batch cap (bytes, not characters)
        if (typeof rec.summary === 'string') totalBytes += getByteLength(rec.summary);
        if (typeof rec.content === 'string') totalBytes += getByteLength(rec.content);
        if (typeof rec.title === 'string') totalBytes += getByteLength(rec.title);
      }
      if (totalBytes > limits.maxBatchTotalBytes) {
        return 'Payload too large: batch summary exceeds size limit';
      }
      return null;
    }
    case 'SQLITE_UPDATE': {
      const payload = msg.payload as Record<string, unknown>;
      if (stringExceeds(payload.summary, limits.maxStringBytes)) {
        return 'Payload too large: summary exceeds 1MB limit';
      }
      if (stringExceeds(payload.content, limits.maxStringBytes)) {
        return 'Payload too large: content exceeds 1MB limit';
      }
      if (stringExceeds(payload.title, limits.maxStringBytes)) {
        return 'Payload too large: title exceeds 1MB limit';
      }
      return null;
    }
    case 'SQLITE_RESTORE': {
      const rawData = (msg.payload as { data?: unknown }).data;
      if (Array.isArray(rawData) && rawData.length > limits.maxRestoreBytes) {
        return 'Restore data exceeds maximum size of 100MB';
      }
      return null;
    }
    default:
      return null;
  }
}
