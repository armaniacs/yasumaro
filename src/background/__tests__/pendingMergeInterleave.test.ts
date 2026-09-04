/**
 * pendingMergeInterleave.test.ts
 * Facade-level interleave: a metadata patch enqueued while flush() is
 * mid-cycle must merge in-lock (mutate) instead of clobbering the flush
 * result — and must inherit backoff instead of resetting it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  enqueuePendingWrite,
  flushPendingWrites,
  setPendingWriteQueue,
  createPendingWriteQueue,
  PENDING_CHROME_STORAGE_KEY,
  type PendingMetadataPatchWrite,
} from '../pendingChromeStorageQueue.js';
import { InMemoryAdapter } from '../persistentRetryQueue.js';

function patch(url: string, overrides: Partial<PendingMetadataPatchWrite> = {}): PendingMetadataPatchWrite {
  const now = Date.now();
  return {
    type: 'metadataPatch',
    key: 'savedUrlsWithTimestamps',
    url,
    patch: { title: `t-${url}` },
    timestamp: now,
    mergeTags: true,
    createdAt: now,
    retryCount: 0,
    ...overrides,
  };
}

describe('pending merge under flush (in-lock coalesce)', () => {
  let adapter: InMemoryAdapter;

  beforeEach(() => {
    adapter = new InMemoryAdapter();
    setPendingWriteQueue(createPendingWriteQueue(adapter));
  });

  it('merges a same-URL patch arriving mid-flush without loss and inherits backoff', async () => {
    // Seed an entry that already failed twice.
    const oldTimestamp = Date.now() - 1000;
    await enqueuePendingWrite(
      patch('https://x.example/p', { retryCount: 2, patch: { title: 'old' }, timestamp: oldTimestamp }),
    );

    let releaseHandler!: (ok: boolean) => void;
    const handlerGate = new Promise<boolean>((r) => {
      releaseHandler = r;
    });
    const retryFn = vi.fn(async () => handlerGate);

    const flushP = flushPendingWrites(retryFn);
    // Wait until flush reaches the handler, then race the merge in.
    await vi.waitFor(() => expect(retryFn).toHaveBeenCalledTimes(1));
    const newTimestamp = Date.now();
    const enqueueP = enqueuePendingWrite(
      patch('https://x.example/p', {
        patch: { title: 'new' },
        timestamp: newTimestamp,
        retryCount: 0,
      }),
    );
    releaseHandler(false);
    await Promise.all([flushP, enqueueP]);

    const writes = await adapter.load<PendingMetadataPatchWrite>(PENDING_CHROME_STORAGE_KEY);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.patch).toMatchObject({ title: 'new' });
    expect(writes[0]?.timestamp).toBe(newTimestamp);
    // Backoff inherited, not reset to 0: seeded 2 + the failed flush attempt
    // consumed one retry before the merge landed.
    expect(writes[0]?.retryCount).toBe(3);
  });

  it('merges tags by union on the locked path', async () => {
    await enqueuePendingWrite(
      patch('https://x.example/p', { patch: { tags: ['a'] }, mergeTags: true }),
    );
    await enqueuePendingWrite(
      patch('https://x.example/p', { patch: { tags: ['b'] }, mergeTags: true }),
    );

    const writes = await adapter.load<PendingMetadataPatchWrite>(PENDING_CHROME_STORAGE_KEY);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.patch.tags).toEqual(expect.arrayContaining(['a', 'b']));
  });
});
