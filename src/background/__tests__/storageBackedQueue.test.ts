import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PersistentRetryQueue, ChromeStorageAdapter } from '../persistentRetryQueue.js';

describe('StorageBackedQueue (PersistentRetryQueue)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads an empty queue when nothing is stored', async () => {
    const stored: Record<string, unknown> = {};
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          async get(key: string) {
            return { [key]: stored[key] };
          },
          async set(obj: Record<string, unknown>) {
            Object.assign(stored, obj);
          },
        },
      },
    });
    const adapter = new ChromeStorageAdapter();
    const q = new PersistentRetryQueue<string>(adapter, {
      storageKey: 'test_key',
      maxSize: 5,
      logLabel: 'testQueue',
    });
    expect(await q.load()).toEqual([]);
  });

  it('enqueues and caps at maxSize, dropping oldest items', async () => {
    const stored: Record<string, unknown> = {};
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          async get(key: string) {
            return { [key]: stored[key] };
          },
          async set(obj: Record<string, unknown>) {
            Object.assign(stored, obj);
          },
        },
      },
    });
    const adapter = new ChromeStorageAdapter();
    const q = new PersistentRetryQueue<number>(adapter, {
      storageKey: 'test_key',
      maxSize: 3,
      logLabel: 'testQueue',
    });
    for (let i = 1; i <= 5; i++) {
      await q.enqueue(i);
    }
    const queue = await q.load();
    expect(queue).toEqual([3, 4, 5]);
  });

  it('returns the still-pending items from flush and saves only them', async () => {
    const stored: Record<string, unknown> = { test_key: [1, 2, 3] };
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          async get(key: string) {
            return { [key]: stored[key] };
          },
          async set(obj: Record<string, unknown>) {
            Object.assign(stored, obj);
          },
        },
      },
    });
    const adapter = new ChromeStorageAdapter();
    const q = new PersistentRetryQueue<number>(adapter, {
      storageKey: 'test_key',
      maxSize: 5,
      logLabel: 'testQueue',
    });
    // Item 2 fails; others succeed.
    const stillPending = await q.flush(async (item) => item !== 2);
    expect(stillPending).toEqual([2]);
    expect(stored['test_key']).toEqual([2]);
  });

  it('keeps failed items across a flush exception', async () => {
    const stored: Record<string, unknown> = { test_key: ['a', 'b'] };
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          async get(key: string) {
            return { [key]: stored[key] };
          },
          async set(obj: Record<string, unknown>) {
            Object.assign(stored, obj);
          },
        },
      },
    });
    const adapter = new ChromeStorageAdapter();
    const q = new PersistentRetryQueue<string>(adapter, {
      storageKey: 'test_key',
      maxSize: 5,
      logLabel: 'testQueue',
    });
    const stillPending = await q.flush(async (item) => {
      if (item === 'a') throw new Error('boom');
      return true;
    });
    expect(stillPending).toEqual(['a']);
    expect(stored['test_key']).toEqual(['a']);
  });
});
