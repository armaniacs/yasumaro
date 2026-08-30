/**
 * payloadGuard.ts
 * Common payload size guard for offscreen SQLite messages.
 * Centralizes the 1 MB field cap, batch limits, and restore size cap
 * that were previously scattered across individual switch cases.
 *
 * The per-column caps are schema-driven: every TEXT column declared in
 * schema.ts is capped, so a new TEXT column is guarded automatically
 * without editing this file. Unknown fields in a write payload are
 * rejected (fail-closed) rather than silently forwarded to SQLite.
 */

import type { SqliteMessage } from '../messaging/sqliteMessages.js';
import { COLUMN_NAMES, SCHEMA_SQL } from './schema.js';

/** Per-field cap for large text fields. */
export const MAX_PAYLOAD_STRING_BYTES = 1024 * 1024; // 1 MB

/** Maximum records per INSERT_BATCH. */
export const MAX_BATCH_RECORDS = 2000;

/** Total bytes of text across a batch. */
export const MAX_BATCH_TOTAL_BYTES = 20 * 1024 * 1024; // 20 MB

/** Total bytes of text across a single write payload (all TEXT columns summed). */
export const MAX_PAYLOAD_TOTAL_BYTES = 20 * 1024 * 1024; // 20 MB

/** Maximum bytes for RESTORE binary payload. */
export const MAX_RESTORE_BYTES = 100 * 1024 * 1024; // 100 MB

/**
 * TEXT columns from schema.ts — parsed from the CREATE TABLE DDL so it stays
 * in lockstep with the schema. Any column declared `<name> TEXT` is included.
 */
export const TEXT_COLUMNS: readonly string[] = (() => {
  const textCols = new Set<string>();
  const columnLine = /^\s*([a-z_]+)\s+TEXT\b/i;
  for (const rawLine of SCHEMA_SQL.split('\n')) {
    const m = rawLine.match(columnLine);
    if (m && m[1]) textCols.add(m[1]);
  }
  return COLUMN_NAMES.filter((c) => textCols.has(c));
})();

/** Fields accepted in a write payload: every schema column plus the row id. */
const KNOWN_WRITE_FIELDS: ReadonlySet<string> = new Set<string>([
  'id',
  ...COLUMN_NAMES,
  'traceId',
]);

export interface PayloadLimits {
  maxStringBytes: number;
  maxBatchRecords: number;
  maxBatchTotalBytes: number;
  maxPayloadTotalBytes: number;
  maxRestoreBytes: number;
}

export const DEFAULT_PAYLOAD_LIMITS: PayloadLimits = {
  maxStringBytes: MAX_PAYLOAD_STRING_BYTES,
  maxBatchRecords: MAX_BATCH_RECORDS,
  maxBatchTotalBytes: MAX_BATCH_TOTAL_BYTES,
  maxPayloadTotalBytes: MAX_PAYLOAD_TOTAL_BYTES,
  maxRestoreBytes: MAX_RESTORE_BYTES,
};

function getByteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).byteLength;
  }
  try {
    if (typeof Blob !== 'undefined') {
      return new Blob([value]).size;
    }
  } catch {
    // fall through
  }
  return value.length;
}

/**
 * Check a record's TEXT columns against the per-column cap and the total cap.
 * `label` distinguishes an insert record from a batch record in the message.
 * Returns an error string or null.
 */
function checkTextColumns(
  rec: Record<string, unknown>,
  limits: PayloadLimits,
): string | null {
  let total = 0;
  for (const col of TEXT_COLUMNS) {
    const value = rec[col];
    if (typeof value !== 'string') continue;
    const bytes = getByteLength(value);
    if (bytes > limits.maxStringBytes) {
      return `Payload too large: ${col} exceeds 1MB limit`;
    }
    total += bytes;
  }
  if (total > limits.maxPayloadTotalBytes) {
    return 'Payload too large: total text size exceeds limit';
  }
  return null;
}

/**
 * Reject a write payload that carries a field outside the schema. Prevents an
 * uncapped attacker-supplied key from being forwarded to the DB layer.
 */
function checkUnknownFields(rec: Record<string, unknown>): string | null {
  for (const key of Object.keys(rec)) {
    if (!KNOWN_WRITE_FIELDS.has(key)) {
      return `Payload rejected: unknown field "${key}"`;
    }
  }
  return null;
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
      return checkUnknownFields(payload) ?? checkTextColumns(payload, limits);
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
        const unknownErr = checkUnknownFields(rec);
        if (unknownErr) return unknownErr;
        const colErr = checkTextColumns(rec, limits);
        if (colErr) return colErr;
        for (const col of TEXT_COLUMNS) {
          if (typeof rec[col] === 'string') totalBytes += getByteLength(rec[col] as string);
        }
      }
      if (totalBytes > limits.maxBatchTotalBytes) {
        return 'Payload too large: batch summary exceeds size limit';
      }
      return null;
    }
    case 'SQLITE_UPDATE': {
      const payload = msg.payload as Record<string, unknown>;
      return checkUnknownFields(payload) ?? checkTextColumns(payload, limits);
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
