/**
 * pendingSqliteQueue.test.ts
 * M14: when SQLite is temporarily unavailable, a failed insert must be
 * queued in chrome.storage.local instead of silently dropping the record.
 * A later flush (e.g. Service Worker startup) retries queued records in
 * chunks using insertBatch() to reduce offscreen round-trips.
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

  it('flushPendingRecords processes records in 50-item chunks using insertBatch', async () => {
    // 120 records -> chunks of 50, 50, 20
    for (let i = 0; i < 120; i++) {
      await enqueuePendingRecord(makeRecord(`https://example-${i}.com`));
    }

    const insertBatch = vi.fn().mockResolvedValue({ count: 50 });

    await flushPendingRecords({ insert: vi.fn(), insertBatch } as any);

    expect(insertBatch).toHaveBeenCalledTimes(3);
    expect(insertBatch.mock.calls[0][0]).toHaveLength(50);
    expect(insertBatch.mock.calls[1][0]).toHaveLength(50);
    expect(insertBatch.mock.calls[2][0]).toHaveLength(20);

    const remaining = mockStorage[PENDING_SQLITE_RECORDS_KEY] as BrowsingLogRecord[];
    expect(remaining).toHaveLength(0);
  });

  it('flushPendingRecords keeps only failed chunks pending', async () => {
    // 150 records -> 3 chunks of 50; second chunk fails
    for (let i = 0; i < 150; i++) {
      await enqueuePendingRecord(makeRecord(`https://example-${i}.com`));
    }

    const insertBatch = vi.fn()
      .mockResolvedValueOnce({ count: 50 }) // chunk 1 succeeds
      .mockResolvedValueOnce(null) // chunk 2 fails
      .mockResolvedValueOnce({ count: 50 }); // chunk 3 succeeds

    await flushPendingRecords({ insert: vi.fn(), insertBatch } as any);

    expect(insertBatch).toHaveBeenCalledTimes(3);

    const remaining = mockStorage[PENDING_SQLITE_RECORDS_KEY] as BrowsingLogRecord[];
    expect(remaining).toHaveLength(50);
    // Failed chunk should be the middle 50 records (indices 50-99)
    expect(remaining[0].url).toBe('https://example-50.com');
    expect(remaining[49].url).toBe('https://example-99.com');
  });

  it('flushPendingRecords keeps the chunk pending when insertBatch throws', async () => {
    for (let i = 0; i < 100; i++) {
      await enqueuePendingRecord(makeRecord(`https://example-${i}.com`));
    }

    const insertBatch = vi.fn()
      .mockResolvedValueOnce({ count: 50 })
      .mockRejectedValueOnce(new Error('DB unavailable'));

    await flushPendingRecords({ insert: vi.fn(), insertBatch } as any);

    const remaining = mockStorage[PENDING_SQLITE_RECORDS_KEY] as BrowsingLogRecord[];
    expect(remaining).toHaveLength(50);
    expect(remaining[0].url).toBe('https://example-50.com');
  });

  it('flushPendingRecords does nothing when the queue is empty', async () => {
    const insertBatch = vi.fn();

    await flushPendingRecords({ insert: vi.fn(), insertBatch } as any);

    expect(insertBatch).not.toHaveBeenCalled();
  });

  it('flushPendingRecords logs recovered/remaining counts', async () => {
    const { addLog, LogType } = await import('../../utils/logger.js');

    for (let i = 0; i < 100; i++) {
      await enqueuePendingRecord(makeRecord(`https://example-${i}.com`));
    }

    const insertBatch = vi.fn()
      .mockResolvedValueOnce({ count: 50 })
      .mockResolvedValueOnce(null);

    await flushPendingRecords({ insert: vi.fn(), insertBatch } as any);

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
