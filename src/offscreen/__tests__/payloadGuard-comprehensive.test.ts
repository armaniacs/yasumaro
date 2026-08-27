/**
 * payloadGuard-comprehensive.test.ts
 * Comprehensive tests for assertPayloadSize — covers all message types
 * (SQLITE_INSERT, SQLITE_INSERT_BATCH, SQLITE_UPDATE, SQLITE_RESTORE),
 * boundary values, edge cases, and custom limits.
 */

import { describe, it, expect } from 'vitest';
import {
  assertPayloadSize,
  MAX_PAYLOAD_STRING_BYTES,
  MAX_BATCH_RECORDS,
  MAX_BATCH_TOTAL_BYTES,
  MAX_RESTORE_BYTES,
  DEFAULT_PAYLOAD_LIMITS,
} from '../payloadGuard.js';
import type { SqliteMessage } from '../../messaging/sqliteMessages.js';

// Helper to create typed message objects
function insertMsg(payload: Record<string, unknown>): SqliteMessage {
  return { type: 'SQLITE_INSERT', payload } as unknown as SqliteMessage;
}

function batchMsg(records: unknown[]): SqliteMessage {
  return { type: 'SQLITE_INSERT_BATCH', payload: { records } } as unknown as SqliteMessage;
}

function updateMsg(payload: Record<string, unknown>): SqliteMessage {
  return { type: 'SQLITE_UPDATE', payload } as unknown as SqliteMessage;
}

function restoreMsg(data: unknown): SqliteMessage {
  return { type: 'SQLITE_RESTORE', payload: { data } } as unknown as SqliteMessage;
}

// ── Constants verification ─────────────────────────────────────────────

describe('payload limit constants', () => {
  it('MAX_PAYLOAD_STRING_BYTES is 1MB', () => {
    expect(MAX_PAYLOAD_STRING_BYTES).toBe(1024 * 1024);
  });

  it('MAX_BATCH_RECORDS is 2000', () => {
    expect(MAX_BATCH_RECORDS).toBe(2000);
  });

  it('MAX_BATCH_TOTAL_BYTES is 20MB', () => {
    expect(MAX_BATCH_TOTAL_BYTES).toBe(20 * 1024 * 1024);
  });

  it('MAX_RESTORE_BYTES is 100MB', () => {
    expect(MAX_RESTORE_BYTES).toBe(100 * 1024 * 1024);
  });

  it('DEFAULT_PAYLOAD_LIMITS matches the constants', () => {
    expect(DEFAULT_PAYLOAD_LIMITS.maxStringBytes).toBe(MAX_PAYLOAD_STRING_BYTES);
    expect(DEFAULT_PAYLOAD_LIMITS.maxBatchRecords).toBe(MAX_BATCH_RECORDS);
    expect(DEFAULT_PAYLOAD_LIMITS.maxBatchTotalBytes).toBe(MAX_BATCH_TOTAL_BYTES);
    expect(DEFAULT_PAYLOAD_LIMITS.maxRestoreBytes).toBe(MAX_RESTORE_BYTES);
  });
});

// ── SQLITE_INSERT ──────────────────────────────────────────────────────

describe('SQLITE_INSERT', () => {
  it('returns null for a normal-sized insert', () => {
    const result = assertPayloadSize(insertMsg({
      url: 'https://example.com',
      summary: 'Normal summary',
      content: 'Normal content',
      title: 'Normal title',
    }));
    expect(result).toBeNull();
  });

  it('rejects when summary exceeds 1MB', () => {
    const result = assertPayloadSize(insertMsg({
      summary: 'x'.repeat(MAX_PAYLOAD_STRING_BYTES + 1),
    }));
    expect(result).toContain('summary');
    expect(result).toContain('exceeds');
  });

  it('rejects when content exceeds 1MB', () => {
    const result = assertPayloadSize(insertMsg({
      content: 'x'.repeat(MAX_PAYLOAD_STRING_BYTES + 1),
    }));
    expect(result).toContain('content');
  });

  it('rejects when title exceeds 1MB', () => {
    const result = assertPayloadSize(insertMsg({
      title: 'x'.repeat(MAX_PAYLOAD_STRING_BYTES + 1),
    }));
    expect(result).toContain('title');
  });

  it('accepts string at exactly 1MB', () => {
    const result = assertPayloadSize(insertMsg({
      summary: 'x'.repeat(MAX_PAYLOAD_STRING_BYTES),
    }));
    expect(result).toBeNull();
  });

  it('returns null when summary/content/title are not strings', () => {
    const result = assertPayloadSize(insertMsg({
      summary: 12345,
      content: null,
      title: undefined,
    }));
    expect(result).toBeNull();
  });

  it('returns null for empty payload (no oversized fields)', () => {
    const result = assertPayloadSize(insertMsg({}));
    expect(result).toBeNull();
  });
});

// ── SQLITE_INSERT_BATCH ────────────────────────────────────────────────

describe('SQLITE_INSERT_BATCH', () => {
  it('returns null for a normal batch', () => {
    const records = Array.from({ length: 10 }, (_, i) => ({
      url: `https://example.com/${i}`,
      summary: `Summary ${i}`,
    }));
    const result = assertPayloadSize(batchMsg(records));
    expect(result).toBeNull();
  });

  it('rejects when records is not an array', () => {
    const result = assertPayloadSize(batchMsg('not an array' as unknown as unknown[]));
    expect(result).toContain('maximum');
  });

  it('rejects when batch exceeds max records', () => {
    const records = Array.from({ length: MAX_BATCH_RECORDS + 1 }, (_, i) => ({
      url: `https://example.com/${i}`,
    }));
    const result = assertPayloadSize(batchMsg(records));
    expect(result).toContain('maximum');
    expect(result).toContain(String(MAX_BATCH_RECORDS));
  });

  it('accepts batch at exactly max records', () => {
    const records = Array.from({ length: MAX_BATCH_RECORDS }, (_, i) => ({
      url: `https://example.com/${i}`,
    }));
    const result = assertPayloadSize(batchMsg(records));
    expect(result).toBeNull();
  });

  it('rejects when a single record in batch has oversized summary', () => {
    const records = [
      { url: 'https://ok.com', summary: 'ok' },
      { url: 'https://bad.com', summary: 'x'.repeat(MAX_PAYLOAD_STRING_BYTES + 1) },
    ];
    const result = assertPayloadSize(batchMsg(records));
    expect(result).toContain('summary');
  });

  it('rejects when a single record in batch has oversized content', () => {
    const records = [
      { url: 'https://bad.com', content: 'x'.repeat(MAX_PAYLOAD_STRING_BYTES + 1) },
    ];
    const result = assertPayloadSize(batchMsg(records));
    expect(result).toContain('content');
  });

  it('rejects when a single record in batch has oversized title', () => {
    const records = [
      { url: 'https://bad.com', title: 'x'.repeat(MAX_PAYLOAD_STRING_BYTES + 1) },
    ];
    const result = assertPayloadSize(batchMsg(records));
    expect(result).toContain('title');
  });

  it('rejects when total batch text bytes exceed 20MB', () => {
    // Each record contributes ~1MB, so 21 records = 21MB > 20MB limit
    const records = Array.from({ length: 21 }, (_, i) => ({
      url: `https://example.com/${i}`,
      summary: 'x'.repeat(MAX_PAYLOAD_STRING_BYTES),
    }));
    const result = assertPayloadSize(batchMsg(records));
    expect(result).toContain('batch');
  });

  it('accepts batch at just under the total bytes limit', () => {
    // 19 records of ~1MB each = 19MB < 20MB
    const records = Array.from({ length: 19 }, (_, i) => ({
      url: `https://example.com/${i}`,
      summary: 'x'.repeat(MAX_PAYLOAD_STRING_BYTES),
    }));
    const result = assertPayloadSize(batchMsg(records));
    expect(result).toBeNull();
  });

  it('handles batch with null/non-object records (skips them)', () => {
    const records = [null, undefined, 'string', 42, { url: 'https://ok.com' }];
    const result = assertPayloadSize(batchMsg(records));
    expect(result).toBeNull();
  });

  it('handles empty batch array', () => {
    const result = assertPayloadSize(batchMsg([]));
    expect(result).toBeNull();
  });

  it('uses custom limits when provided', () => {
    const customLimits = { ...DEFAULT_PAYLOAD_LIMITS, maxBatchRecords: 5 };
    const records = Array.from({ length: 6 }, (_, i) => ({ url: `https://e.com/${i}` }));
    const result = assertPayloadSize(batchMsg(records), customLimits);
    expect(result).toContain('maximum');
  });
});

// ── SQLITE_UPDATE ──────────────────────────────────────────────────────

describe('SQLITE_UPDATE', () => {
  it('returns null for normal update', () => {
    const result = assertPayloadSize(updateMsg({
      id: 1,
      summary: 'Updated summary',
    }));
    expect(result).toBeNull();
  });

  it('rejects when summary exceeds 1MB', () => {
    const result = assertPayloadSize(updateMsg({
      id: 1,
      summary: 'x'.repeat(MAX_PAYLOAD_STRING_BYTES + 1),
    }));
    expect(result).toContain('summary');
  });

  it('rejects when content exceeds 1MB', () => {
    const result = assertPayloadSize(updateMsg({
      id: 1,
      content: 'x'.repeat(MAX_PAYLOAD_STRING_BYTES + 1),
    }));
    expect(result).toContain('content');
  });

  it('rejects when title exceeds 1MB', () => {
    const result = assertPayloadSize(updateMsg({
      id: 1,
      title: 'x'.repeat(MAX_PAYLOAD_STRING_BYTES + 1),
    }));
    expect(result).toContain('title');
  });

  it('returns null when no text fields are present', () => {
    const result = assertPayloadSize(updateMsg({ id: 1, is_starred: 1 }));
    expect(result).toBeNull();
  });
});

// ── SQLITE_RESTORE ─────────────────────────────────────────────────────

describe('SQLITE_RESTORE', () => {
  it('returns null for normal restore data', () => {
    const data = Array.from({ length: 100 }, (_, i) => i);
    const result = assertPayloadSize(restoreMsg(data));
    expect(result).toBeNull();
  });

  it('rejects when data array exceeds max restore bytes', () => {
    const limits = { ...DEFAULT_PAYLOAD_LIMITS, maxRestoreBytes: 10 };
    const result = assertPayloadSize(restoreMsg(Array.from({ length: 11 })), limits);
    expect(result).toContain('Restore');
  });

  it('returns null when data is not an array', () => {
    const result = assertPayloadSize(restoreMsg('not an array'));
    expect(result).toBeNull();
  });

  it('returns null for empty data array', () => {
    const result = assertPayloadSize(restoreMsg([]));
    expect(result).toBeNull();
  });
});

// ── Unknown message type ───────────────────────────────────────────────

describe('unknown message type', () => {
  it('returns null for unrecognized message types', () => {
    const result = assertPayloadSize({ type: 'UNKNOWN_TYPE', payload: {} } as unknown as SqliteMessage);
    expect(result).toBeNull();
  });
});

// ── Custom limits ──────────────────────────────────────────────────────

describe('custom limits', () => {
  it('respects custom maxStringBytes limit', () => {
    const limits = { ...DEFAULT_PAYLOAD_LIMITS, maxStringBytes: 100 };
    const result = assertPayloadSize(
      insertMsg({ summary: 'x'.repeat(101) }),
      limits
    );
    expect(result).toContain('exceeds');
  });

  it('respects custom maxBatchRecords limit', () => {
    const limits = { ...DEFAULT_PAYLOAD_LIMITS, maxBatchRecords: 2 };
    const records = Array.from({ length: 3 }, (_, i) => ({ url: `https://e.com/${i}` }));
    const result = assertPayloadSize(batchMsg(records), limits);
    expect(result).toContain('maximum');
  });

  it('respects custom maxRestoreBytes limit', () => {
    const limits = { ...DEFAULT_PAYLOAD_LIMITS, maxRestoreBytes: 10 };
    const result = assertPayloadSize(restoreMsg(Array.from({ length: 11 })), limits);
    expect(result).toContain('Restore');
  });
});
