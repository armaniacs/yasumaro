/**
 * pendingSqliteQueue.test.ts
 * M14: when SQLite is temporarily unavailable, a failed insert must be
 * queued in chrome.storage.local instead of silently dropping the record.
 * A later flush (e.g. Service Worker startup) retries queued records in
 * chunks using insertBatchResult() to reduce offscreen round-trips.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { BrowsingLogRecord } from '../../utils/sqlite-types.js';

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
}));

import { enqueuePendingRecord, flushPendingRecords, chunkArray, PENDING_SQLITE_RECORDS_KEY } from '../pendingSqliteQueue.js';

function makeRecord(url: string): BrowsingLogRecord {
  return { url, title: 'Test', created_at: Date.now() };
}

describe('pendingSqliteQueue (M14)', () => {
  let mockStorage: Record<string, unknown>;

  beforeEach(() => {
    mockStorage = {};
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn((key: string) => Promise.resolve({ [key]: mockStorage[key] })),
          set: vi.fn((items: Record<string, unknown>) => {
            Object.assign(mockStorage, items);
            return Promise.resolve();
          }),
        },
      },
    });
  });

  it('enqueuePendingRecord appends a record to the pending list', async () => {
    await enqueuePendingRecord(makeRecord('https://a.example.com'));

    const stored = mockStorage[PENDING_SQLITE_RECORDS_KEY] as BrowsingLogRecord[];
    expect(stored).toHaveLength(1);
    expect(stored[0].url).toBe('https://a.example.com');
  });

  it('enqueuePendingRecord appends to existing entries without overwriting them', async () => {
    await enqueuePendingRecord(makeRecord('https://a.example.com'));
    await enqueuePendingRecord(makeRecord('https://b.example.com'));

    const stored = mockStorage[PENDING_SQLITE_RECORDS_KEY] as BrowsingLogRecord[];
    expect(stored).toHaveLength(2);
  });

  it('flushPendingRecords processes records in 50-item chunks using insertBatchResult', async () => {
    // 120 records -> chunks of 50, 50, 20
    for (let i = 0; i < 120; i++) {
      await enqueuePendingRecord(makeRecord(`https://example-${i}.com`));
    }

    const insertBatchResult = vi.fn().mockResolvedValue({ success: true, data: { count: 50 } });

    await flushPendingRecords({ insert: vi.fn(), insertBatchResult } as any);

    expect(insertBatchResult).toHaveBeenCalledTimes(3);
    expect(insertBatchResult.mock.calls[0][0]).toHaveLength(50);
    expect(insertBatchResult.mock.calls[1][0]).toHaveLength(50);
    expect(insertBatchResult.mock.calls[2][0]).toHaveLength(20);

    const remaining = mockStorage[PENDING_SQLITE_RECORDS_KEY] as BrowsingLogRecord[];
    expect(remaining).toHaveLength(0);
  });

  it('flushPendingRecords keeps only failed chunks pending', async () => {
    // 150 records -> 3 chunks of 50; second chunk fails
    for (let i = 0; i < 150; i++) {
      await enqueuePendingRecord(makeRecord(`https://example-${i}.com`));
    }

    const insertBatchResult = vi.fn()
      .mockResolvedValueOnce({ success: true, data: { count: 50 } }) // chunk 1 succeeds
      .mockResolvedValueOnce({ success: false, error: { kind: 'sqlite_error', message: 'insert failed', retriable: false } }) // chunk 2 fails
      .mockResolvedValueOnce({ success: true, data: { count: 50 } }); // chunk 3 succeeds

    await flushPendingRecords({ insert: vi.fn(), insertBatchResult } as any);

    expect(insertBatchResult).toHaveBeenCalledTimes(3);

    const remaining = mockStorage[PENDING_SQLITE_RECORDS_KEY] as BrowsingLogRecord[];
    expect(remaining).toHaveLength(50);
    // Failed chunk should be the middle 50 records (indices 50-99)
    expect(remaining[0].url).toBe('https://example-50.com');
    expect(remaining[49].url).toBe('https://example-99.com');
  });

  it('flushPendingRecords keeps the chunk pending when insertBatchResult throws', async () => {
    for (let i = 0; i < 100; i++) {
      await enqueuePendingRecord(makeRecord(`https://example-${i}.com`));
    }

    const insertBatchResult = vi.fn()
      .mockResolvedValueOnce({ success: true, data: { count: 50 } })
      .mockRejectedValueOnce(new Error('DB unavailable'));

    await flushPendingRecords({ insert: vi.fn(), insertBatchResult } as any);

    const remaining = mockStorage[PENDING_SQLITE_RECORDS_KEY] as BrowsingLogRecord[];
    expect(remaining).toHaveLength(50);
    expect(remaining[0].url).toBe('https://example-50.com');
  });

  it('flushPendingRecords does nothing when the queue is empty', async () => {
    const insertBatchResult = vi.fn();

    await flushPendingRecords({ insert: vi.fn(), insertBatchResult } as any);

    expect(insertBatchResult).not.toHaveBeenCalled();
  });

  it('flushPendingRecords logs recovered/remaining counts', async () => {
    const { addLog, LogType } = await import('../../utils/logger.js');

    for (let i = 0; i < 100; i++) {
      await enqueuePendingRecord(makeRecord(`https://example-${i}.com`));
    }

    const insertBatchResult = vi.fn()
      .mockResolvedValueOnce({ success: true, data: { count: 50 } })
      .mockResolvedValueOnce({ success: false, error: { kind: 'sqlite_error', message: 'insert failed', retriable: false } });

    await flushPendingRecords({ insert: vi.fn(), insertBatchResult } as any);

    expect(addLog).toHaveBeenCalledWith(LogType.INFO, 'pendingSqliteQueue: flushed queued records', {
      recovered: 50,
      remaining: 50,
    });
  });
});

describe('chunkArray', () => {
  it('returns one chunk when items are fewer than size', () => {
    const chunks = chunkArray([1, 2, 3], 50);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual([1, 2, 3]);
  });

  it('splits exactly at the chunk size boundary (49, 50, 51)', () => {
    const items49 = Array.from({ length: 49 }, (_, i) => i);
    expect(chunkArray(items49, 50)).toHaveLength(1);

    const items50 = Array.from({ length: 50 }, (_, i) => i);
    expect(chunkArray(items50, 50)).toHaveLength(1);

    const items51 = Array.from({ length: 51 }, (_, i) => i);
    const chunks51 = chunkArray(items51, 50);
    expect(chunks51).toHaveLength(2);
    expect(chunks51[0]).toHaveLength(50);
    expect(chunks51[1]).toHaveLength(1);
  });

  it('splits 100 items into two 50-item chunks', () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const chunks = chunkArray(items, 50);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(50);
    expect(chunks[1]).toHaveLength(50);
  });
});

describe('pendingSqliteQueue retry semantics', () => {
  let mockStorage: Record<string, unknown>;

  beforeEach(() => {
    mockStorage = {};
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn((key: string) => Promise.resolve({ [key]: mockStorage[key] })),
          set: vi.fn((items: Record<string, unknown>) => {
            Object.assign(mockStorage, items);
            return Promise.resolve();
          }),
        },
      },
    });
  });

  it('wraps records with createdAt and retryCount on enqueue', async () => {
    await enqueuePendingRecord(makeRecord('https://a.example.com'));

    const stored = mockStorage[PENDING_SQLITE_RECORDS_KEY] as Array<Record<string, unknown>>;
    expect(stored).toHaveLength(1);
    expect(stored[0].createdAt).toBeDefined();
    expect(typeof stored[0].createdAt).toBe('number');
    expect(stored[0].retryCount).toBe(0);
    expect(stored[0].url).toBe('https://a.example.com');
  });

  it('unwraps metadata before passing to insertBatchResult', async () => {
    await enqueuePendingRecord(makeRecord('https://a.example.com'));
    await enqueuePendingRecord(makeRecord('https://b.example.com'));

    const insertBatchResult = vi.fn().mockResolvedValue({ success: true, data: { count: 2 } });

    await flushPendingRecords({ insert: vi.fn(), insertBatchResult } as any);

    // The records passed to insertBatchResult should be plain BrowsingLogRecords
    // (no createdAt or retryCount fields)
    const passedRecords = insertBatchResult.mock.calls[0][0];
    expect(passedRecords).toHaveLength(2);
    expect(passedRecords[0].url).toBe('https://a.example.com');
    expect(passedRecords[0].createdAt).toBeUndefined();
    expect(passedRecords[0].retryCount).toBeUndefined();
    expect(passedRecords[1].url).toBe('https://b.example.com');
  });

  it('drops records that exceed max retry count (5)', async () => {
    // Simulate a record that has already failed 5 times
    const queuedRecord = {
      ...makeRecord('https://a.example.com'),
      createdAt: Date.now(),
      retryCount: 5, // already at max
    };
    mockStorage[PENDING_SQLITE_RECORDS_KEY] = [queuedRecord];

    const insertBatchResult = vi.fn();

    await flushPendingRecords({ insert: vi.fn(), insertBatchResult } as any);

    // Record should be dropped (retryCount 5 >= maxRetryCount 5), not inserted
    expect(insertBatchResult).not.toHaveBeenCalled();
    // Queue should be empty after drop
    const remaining = mockStorage[PENDING_SQLITE_RECORDS_KEY] as unknown[];
    expect(remaining).toHaveLength(0);
  });

  it('increments retryCount on failed chunks and retains them', async () => {
    // Pre-populate with a QueuedRecord that has retryCount=0
    const queuedRecord = {
      ...makeRecord('https://a.example.com'),
      createdAt: Date.now(),
      retryCount: 0,
    };
    mockStorage[PENDING_SQLITE_RECORDS_KEY] = [queuedRecord];

    const insertBatchResult = vi.fn().mockResolvedValue({
      success: false,
      error: { kind: 'sqlite_error', message: 'insert failed', retriable: false },
    });

    await flushPendingRecords({ insert: vi.fn(), insertBatchResult } as any);

    const remaining = mockStorage[PENDING_SQLITE_RECORDS_KEY] as Array<Record<string, unknown>>;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].retryCount).toBe(1);
    expect(remaining[0].url).toBe('https://a.example.com');
  });

  it('drops records after 5 failed flush attempts', async () => {
    // Simulate a record that has failed 4 times already
    const queuedRecord = {
      ...makeRecord('https://a.example.com'),
      createdAt: Date.now(),
      retryCount: 4,
    };
    mockStorage[PENDING_SQLITE_RECORDS_KEY] = [queuedRecord];

    const insertBatchResult = vi.fn().mockResolvedValue({
      success: false,
      error: { kind: 'sqlite_error', message: 'insert failed', retriable: false },
    });

    // This flush increments to 5, which equals maxRetryCount (5) -> dropped
    await flushPendingRecords({ insert: vi.fn(), insertBatchResult } as any);

    const remaining = mockStorage[PENDING_SQLITE_RECORDS_KEY] as unknown[];
    expect(remaining).toHaveLength(0);
  });

  it('drops expired records (older than 24h)', async () => {
    const expiredRecord = {
      ...makeRecord('https://old.example.com'),
      createdAt: Date.now() - (25 * 60 * 60 * 1000), // 25 hours ago
      retryCount: 0,
    };
    mockStorage[PENDING_SQLITE_RECORDS_KEY] = [expiredRecord];

    const insertBatchResult = vi.fn();

    await flushPendingRecords({ insert: vi.fn(), insertBatchResult } as any);

    expect(insertBatchResult).not.toHaveBeenCalled();
    const remaining = mockStorage[PENDING_SQLITE_RECORDS_KEY] as unknown[];
    expect(remaining).toHaveLength(0);
  });
});
