/**
 * pendingSqliteQueue.test.ts
 * M14: when SQLite is temporarily unavailable, a failed insert must be
 * queued in chrome.storage.local instead of silently dropping the record.
 * A later flush (e.g. Service Worker startup) retries queued records and
 * removes only the ones that succeed.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { BrowsingLogRecord } from '../../utils/sqlite-types.js';

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
}));

import { enqueuePendingRecord, flushPendingRecords, PENDING_SQLITE_RECORDS_KEY } from '../pendingSqliteQueue.js';

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

  it('flushPendingRecords retries each record and removes only the successful ones', async () => {
    await enqueuePendingRecord(makeRecord('https://a.example.com'));
    await enqueuePendingRecord(makeRecord('https://b.example.com'));

    const insert = vi.fn()
      .mockResolvedValueOnce({ id: 1 }) // a succeeds
      .mockResolvedValueOnce(null); // b still fails

    await flushPendingRecords({ insert } as any);

    expect(insert).toHaveBeenCalledTimes(2);
    const remaining = mockStorage[PENDING_SQLITE_RECORDS_KEY] as BrowsingLogRecord[];
    expect(remaining).toHaveLength(1);
    expect(remaining[0].url).toBe('https://b.example.com');
  });

  it('flushPendingRecords does nothing when the queue is empty', async () => {
    const insert = vi.fn();

    await flushPendingRecords({ insert } as any);

    expect(insert).not.toHaveBeenCalled();
  });
});
