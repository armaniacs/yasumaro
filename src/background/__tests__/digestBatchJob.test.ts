/**
 * digestBatchJob.test.ts
 * PBI 2026-10-22-03: SW-kill-resistant weekly digest batch (chunked resume).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  runDigestBatch,
  type DigestBatchCheckpoint,
  type DigestCheckpointStore,
} from '../digestBatchJob.js';

function makeStore(initial: { checkpoint?: DigestBatchCheckpoint | null; completed?: string | null } = {}): DigestCheckpointStore & {
  savedCheckpoints: DigestBatchCheckpoint[];
  completedWrites: string[];
} {
  let checkpoint: DigestBatchCheckpoint | null = initial.checkpoint ?? null;
  let completed: string | null = initial.completed ?? null;
  const savedCheckpoints: DigestBatchCheckpoint[] = [];
  const completedWrites: string[] = [];
  return {
    savedCheckpoints,
    completedWrites,
    loadCheckpoint: async () => checkpoint,
    saveCheckpoint: async (next: DigestBatchCheckpoint) => {
      checkpoint = next;
      savedCheckpoints.push(next);
    },
    loadCompletedPeriod: async () => completed,
    saveCompletedPeriod: async (periodKey: string) => {
      completed = periodKey;
      completedWrites.push(periodKey);
    },
    clearCheckpoint: async () => {
      checkpoint = null;
    },
  };
}

const ENTRIES = [
  { id: 1, summary: 'alpha' },
  { id: 2, summary: 'beta' },
  { id: 3, summary: 'gamma' },
  { id: 4, summary: 'delta' },
];

const fold = (digest: string, entry: { summary: string }): string =>
  digest === '' ? entry.summary : `${digest}\n${entry.summary}`;

describe('runDigestBatch', () => {
  it('processes in chunks and resumes from the checkpoint after a kill', async () => {
    const store = makeStore();
    const publish = vi.fn(async (_periodKey: string, _digest: string, _count: number) => true);
    const first = await runDigestBatch({
      store, entries: ENTRIES, periodKey: '2026-W43', chunkSize: 2, foldEntry: fold, publishDigest: publish,
    });
    expect(first.completed).toBe(false);
    expect(first.processedTotal).toBe(2);
    expect(publish).not.toHaveBeenCalled();
    // SW dies here: a fresh invocation with the same store resumes.
    const second = await runDigestBatch({
      store, entries: ENTRIES, periodKey: '2026-W43', chunkSize: 2, foldEntry: fold, publishDigest: publish,
    });
    expect(second.completed).toBe(true);
    expect(second.processedTotal).toBe(4);
    expect(publish).toHaveBeenCalledTimes(1);
    const onlyCall = publish.mock.calls[0];
    if (!onlyCall) throw new Error('expected one publish call');
    expect(onlyCall[1]).toBe('alpha\nbeta\ngamma\ndelta');
  });

  it('is idempotent: a completed period never republishes', async () => {
    const store = makeStore({ completed: '2026-W43' });
    const publish = vi.fn(async () => true);
    const result = await runDigestBatch({
      store, entries: ENTRIES, periodKey: '2026-W43', chunkSize: 10, foldEntry: fold, publishDigest: publish,
    });
    expect(result.completed).toBe(true);
    expect(publish).not.toHaveBeenCalled();
  });

  it('keeps the checkpoint when publish fails (retry continues, no duplicate marker)', async () => {
    const store = makeStore();
    const failing = vi.fn(async () => false);
    const result = await runDigestBatch({
      store, entries: ENTRIES, periodKey: '2026-W43', chunkSize: 10, foldEntry: fold, publishDigest: failing,
    });
    expect(result.completed).toBe(false);
    expect(store.completedWrites).toEqual([]);
    expect(store.savedCheckpoints.at(-1)?.nextIndex).toBe(ENTRIES.length);
  });

  it('cancels mid-chunk via isStale and persists progress (cancellable ops)', async () => {
    const store = makeStore();
    let calls = 0;
    const result = await runDigestBatch({
      store,
      entries: ENTRIES,
      periodKey: '2026-W43',
      chunkSize: 10,
      foldEntry: fold,
      publishDigest: vi.fn(async () => true),
      isStale: () => { calls++; return calls > 1; },
    });
    expect(result.completed).toBe(false);
    const checkpoint = store.savedCheckpoints.at(-1);
    expect(checkpoint).toBeDefined();
    expect((checkpoint?.nextIndex ?? 0) < ENTRIES.length).toBe(true);
  });

  it('discards a checkpoint from another period (a new week started)', async () => {
    const store = makeStore({ checkpoint: { periodKey: '2026-W42', nextIndex: 3, processedIds: [1, 2, 3] } });
    const publish = vi.fn(async (_periodKey: string, _digest: string, _count: number) => true);
    const result = await runDigestBatch({
      store, entries: ENTRIES, periodKey: '2026-W43', chunkSize: 10, foldEntry: fold, publishDigest: publish,
    });
    expect(result.completed).toBe(true);
    const firstCall = publish.mock.calls[0];
    if (!firstCall) throw new Error('expected one publish call');
    expect(firstCall[1]).toBe('alpha\nbeta\ngamma\ndelta');
  });

  it('a stale run at the publish boundary persists progress and never writes the marker (重なった tick の検査点後退)', async () => {
    // A previous run folded everything and failed to publish: the checkpoint
    // holds the full index. An overlapping older tick now resumes stale.
    const store = makeStore({ checkpoint: { periodKey: '2026-W43', nextIndex: ENTRIES.length, processedIds: [1, 2, 3, 4] } });
    const publish = vi.fn(async (_periodKey: string, _digest: string, _count: number) => true);
    const result = await runDigestBatch({
      store, entries: ENTRIES, periodKey: '2026-W43', chunkSize: 10, foldEntry: fold, publishDigest: publish,
      isStale: () => true,
    });
    expect(result.completed).toBe(false);
    // The stale run does not publish and does not touch the completion
    // marker: the marker write only happens after a successful publish, and
    // the production store's saveCompletedPeriod monotonicity guard refuses
    // an older period over a newer marker (digestBatchCheckpointStore.ts) —
    // so a stale tick's late checkpoint save can regress nextIndex only
    // (deterministic refold, no correctness loss), never the marker.
    expect(publish).not.toHaveBeenCalled();
    expect(store.completedWrites).toEqual([]);
    expect(store.savedCheckpoints.at(-1)?.nextIndex).toBe(ENTRIES.length);
  });
});
