import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PersistentRetryQueue, type RetryableItem } from '../persistentRetryQueue.js';
import type { QueueStorageAdapter } from '../queueStorageAdapter.js';

interface TestItem extends RetryableItem {
  id: string;
}
function makeItem(id: string): TestItem {
  return { id, createdAt: Date.now(), retryCount: 0 };
}

/**
 * VULN-056 interleave reproduction. A job is enqueued while flush() is mid-cycle.
 * Without the queue lock, enqueue reads the pre-flush snapshot and its save
 * clobbers flush's write, losing the new job (['A','B'] -> ['A']).
 */
function gatedAdapter(): QueueStorageAdapter & { store: Record<string, unknown[]>; releaseLoad: () => void } {
  const store: Record<string, unknown[]> = {};
  let gate: Promise<void> | null = null;
  let release: (() => void) | null = null;
  return {
    store,
    releaseLoad: () => release?.(),
    load: vi.fn(async (key: string) => {
      if (!gate) {
        gate = new Promise<void>((r) => { release = r; });
        await gate;
      }
      return (store[key] ?? []) as unknown[];
    }),
    save: vi.fn(async (key: string, items: unknown[]) => { store[key] = items; }),
  };
}

describe('PersistentRetryQueue concurrent enqueue during flush (VULN-056)', () => {
  let adapter: ReturnType<typeof gatedAdapter>;

  beforeEach(() => {
    adapter = gatedAdapter();
  });

  it('does not lose a job enqueued while flush runs', async () => {
    adapter.store['q'] = [makeItem('A')];
    const queue = new PersistentRetryQueue<TestItem>(adapter, { storageKey: 'q', maxSize: 10, logLabel: 'test' });

    // flush A: handler fails so A is retained.
    const flushP = queue.flush(async () => false);
    // Let flush park on its gated load().
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const enqueueP = queue.enqueue(makeItem('B'));
    for (let i = 0; i < 10; i++) await Promise.resolve();

    adapter.releaseLoad();
    await Promise.all([flushP, enqueueP]);

    const ids = (adapter.store['q'] as TestItem[]).map((i) => i.id).sort();
    expect(ids).toEqual(['A', 'B']);
  });
});
