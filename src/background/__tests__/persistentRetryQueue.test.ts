import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PersistentRetryQueue, chunkArray, type RetryableItem } from '../persistentRetryQueue.js';
import type { QueueStorageAdapter } from '../queueStorageAdapter.js';

interface TestItem extends RetryableItem {
  id: string;
  data: string;
}

function makeItem(id: string, data = 'test'): TestItem {
  return { id, data, createdAt: Date.now(), retryCount: 0 };
}

function createMockAdapter(): QueueStorageAdapter & { store: Record<string, unknown[]> } {
  const store: Record<string, unknown[]> = {};
  return {
    store,
    load: vi.fn(async (key: string) => (store[key] ?? []) as unknown[]),
    save: vi.fn(async (key: string, items: unknown[]) => { store[key] = items; }),
  };
}

describe('PersistentRetryQueue', () => {
  let adapter: ReturnType<typeof createMockAdapter>;
  let queue: PersistentRetryQueue<TestItem>;

  beforeEach(() => {
    adapter = createMockAdapter();
  });

  describe('flush() without persistPerItem', () => {
    beforeEach(() => {
      queue = new PersistentRetryQueue<TestItem>(adapter, {
        storageKey: 'test',
        maxSize: 100,
        logLabel: 'test',
      });
    });

    it('returns empty array for empty queue', async () => {
      const result = await queue.flush(async () => true);
      expect(result).toEqual([]);
    });

    it('removes items when handler returns true', async () => {
      await queue.enqueue(makeItem('a'));
      await queue.enqueue(makeItem('b'));

      const remaining = await queue.flush(async () => true);
      expect(remaining).toEqual([]);
      expect(adapter.store['test']).toEqual([]);
    });

    it('keeps items when handler returns false and increments retryCount', async () => {
      await queue.enqueue(makeItem('a'));

      const remaining = await queue.flush(async () => false);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].retryCount).toBe(1);
    });

    it('increments retryCount on handler error', async () => {
      await queue.enqueue(makeItem('a'));

      const remaining = await queue.flush(async () => { throw new Error('fail'); });
      expect(remaining).toHaveLength(1);
      expect(remaining[0].retryCount).toBe(1);
      expect(remaining[0].lastError).toBe('fail');
    });
  });

  describe('flush() with persistPerItem', () => {
    it('saves after each processed item', async () => {
      queue = new PersistentRetryQueue<TestItem>(adapter, {
        storageKey: 'test',
        maxSize: 100,
        logLabel: 'test',
        persistPerItem: true,
      });

      await queue.enqueue(makeItem('a'));
      await queue.enqueue(makeItem('b'));
      await queue.enqueue(makeItem('c'));

      // Reset to ignore enqueue save counts
      adapter.save.mockClear();

      await queue.flush(async () => false);

      // save called: once per item (3) + final save (1) = 4 times
      expect(adapter.save).toHaveBeenCalledTimes(4);
    });

    it('does not save intermediate state without persistPerItem', async () => {
      queue = new PersistentRetryQueue<TestItem>(adapter, {
        storageKey: 'test',
        maxSize: 100,
        logLabel: 'test',
        persistPerItem: false,
      });

      await queue.enqueue(makeItem('a'));
      await queue.enqueue(makeItem('b'));

      // Reset to ignore enqueue save counts
      adapter.save.mockClear();

      await queue.flush(async () => false);

      // save called: only final save (1 time)
      expect(adapter.save).toHaveBeenCalledTimes(1);
    });

    it('persists retryCount progress after each failing item', async () => {
      queue = new PersistentRetryQueue<TestItem>(adapter, {
        storageKey: 'test',
        maxSize: 100,
        logLabel: 'test',
        persistPerItem: true,
      });

      await queue.enqueue(makeItem('a'));
      await queue.enqueue(makeItem('b'));

      const savedStates: { retryCount: number; id: string }[][] = [];
      adapter.save.mockImplementation(async (key: string, items: unknown[]) => {
        adapter.store[key] = items;
        savedStates.push((items as TestItem[]).map(i => ({ retryCount: i.retryCount, id: i.id })));
      });

      await queue.flush(async () => false);

      // After first item (a fails): remaining = [a(retry=1)]
      expect(savedStates[0]).toEqual([{ retryCount: 1, id: 'a' }]);
      // After second item (b fails): remaining = [a(retry=1), b(retry=1)]
      expect(savedStates[1]).toEqual([
        { retryCount: 1, id: 'a' },
        { retryCount: 1, id: 'b' },
      ]);
    });
  });

  describe('flush() with maxRetryCount', () => {
    it('drops items that exceed max retry count', async () => {
      queue = new PersistentRetryQueue<TestItem>(adapter, {
        storageKey: 'test',
        maxSize: 100,
        logLabel: 'test',
        maxRetryCount: 2,
      });

      await queue.enqueue(makeItem('a'));

      // First flush: retryCount becomes 1
      await queue.flush(async () => false);
      expect(adapter.store['test']).toHaveLength(1);
      expect((adapter.store['test'][0] as TestItem).retryCount).toBe(1);

      // Second flush: retryCount becomes 2, dropped (>= maxRetryCount)
      await queue.flush(async () => false);
      expect(adapter.store['test']).toHaveLength(0);
    });
  });

  describe('flush() with TTL', () => {
    it('drops expired items', async () => {
      queue = new PersistentRetryQueue<TestItem>(adapter, {
        storageKey: 'test',
        maxSize: 100,
        logLabel: 'test',
        ttlMs: 1000,
      });

      const expired: TestItem = { id: 'old', data: 'old', createdAt: Date.now() - 2000, retryCount: 0 };
      adapter.store['test'] = [expired];

      await queue.flush(async () => true);
      expect(adapter.store['test']).toHaveLength(0);
    });
  });

  describe('flush() with maxJobsPerCycle', () => {
    it('processes only maxJobsPerCycle items per flush', async () => {
      queue = new PersistentRetryQueue<TestItem>(adapter, {
        storageKey: 'test',
        maxSize: 100,
        logLabel: 'test',
        maxJobsPerCycle: 2,
      });

      await queue.enqueue(makeItem('a'));
      await queue.enqueue(makeItem('b'));
      await queue.enqueue(makeItem('c'));

      let callCount = 0;
      await queue.flush(async () => { callCount++; return true; });

      expect(callCount).toBe(2);
      expect(adapter.store['test']).toHaveLength(1);
    });
  });

  describe('flushBatch()', () => {
    beforeEach(() => {
      queue = new PersistentRetryQueue<TestItem>(adapter, {
        storageKey: 'test',
        maxSize: 100,
        logLabel: 'test',
        maxRetryCount: 3,
        persistPerItem: true,
      });
    });

    it('processes items in batches and removes successful items', async () => {
      for (let i = 0; i < 5; i++) {
        await queue.enqueue(makeItem(`${i}`));
      }

      await queue.flushBatch(async (items) => items.map(() => true), 2);

      expect(adapter.store['test']).toEqual([]);
    });

    it('retains failed items with incremented retryCount', async () => {
      await queue.enqueue(makeItem('a'));
      await queue.enqueue(makeItem('b'));

      await queue.flushBatch(async () => [false, false], 2);

      const remaining = adapter.store['test'] as TestItem[];
      expect(remaining).toHaveLength(2);
      expect(remaining[0].retryCount).toBe(1);
      expect(remaining[1].retryCount).toBe(1);
    });

    it('drops items that exceed max retry count', async () => {
      // Enqueue items that already have retryCount = 2
      adapter.store['test'] = [
        makeItem('a'),
        makeItem('b'),
      ];
      (adapter.store['test'][0] as TestItem).retryCount = 2;
      (adapter.store['test'][1] as TestItem).retryCount = 2;

      await queue.flushBatch(async () => [false, false], 2);

      // Both should be dropped (retryCount 2 + 1 = 3 >= maxRetryCount 3)
      expect(adapter.store['test']).toHaveLength(0);
    });

    it('handles batch handler throwing', async () => {
      await queue.enqueue(makeItem('a'));
      await queue.enqueue(makeItem('b'));

      await queue.flushBatch(async () => { throw new Error('batch fail'); }, 2);

      const remaining = adapter.store['test'] as TestItem[];
      expect(remaining).toHaveLength(2);
      expect(remaining[0].retryCount).toBe(1);
      expect(remaining[0].lastError).toBe('batch fail');
    });

    it('drops expired items from batch', async () => {
      queue = new PersistentRetryQueue<TestItem>(adapter, {
        storageKey: 'test',
        maxSize: 100,
        logLabel: 'test',
        maxRetryCount: 3,
        ttlMs: 1000,
        persistPerItem: true,
      });

      const expired: TestItem = { id: 'old', data: 'old', createdAt: Date.now() - 2000, retryCount: 0 };
      const fresh: TestItem = { id: 'new', data: 'new', createdAt: Date.now(), retryCount: 0 };
      adapter.store['test'] = [expired, fresh];

      const receivedIds: string[] = [];
      await queue.flushBatch(async (items) => {
        receivedIds.push(...items.map(i => i.id));
        return items.map(() => true);
      }, 50);

      expect(receivedIds).toEqual(['new']);
      expect(adapter.store['test']).toEqual([]);
    });

    it('saves after each batch for SW resilience', async () => {
      for (let i = 0; i < 5; i++) {
        await queue.enqueue(makeItem(`${i}`));
      }

      const saveCalls = adapter.save.mock.calls.length;
      await queue.flushBatch(async () => [true, true], 2);

      // save called: batch 1 (items 0,1) + batch 2 (items 2,3) + batch 3 (item 4) + final = 4
      expect(adapter.save.mock.calls.length).toBe(saveCalls + 4);
    });
  });

  describe('chunkArray()', () => {
    it('returns one chunk when items are fewer than size', () => {
      expect(chunkArray([1, 2, 3], 50)).toEqual([[1, 2, 3]]);
    });

    it('splits exactly at the chunk size boundary', () => {
      const items50 = Array.from({ length: 50 }, (_, i) => i);
      expect(chunkArray(items50, 50)).toHaveLength(1);

      const items51 = Array.from({ length: 51 }, (_, i) => i);
      const chunks = chunkArray(items51, 50);
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toHaveLength(50);
      expect(chunks[1]).toHaveLength(1);
    });
  });
});
