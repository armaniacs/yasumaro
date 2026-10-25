/**
 * digestBatchJob.ts
 *
 * Weekly digest batch job resistant to SW-kill / Offscreen ephemerality
 * (PBI 2026-10-22-03, slice: batch). The existing reviewSummaryGenerator
 * already guards each period with a LAST_GENERATED completion marker, but it
 * processes the whole period inside one SW lifetime: a kill mid-run restarts
 * from zero on the next weekly firing (a week later).
 *
 * This module adds the resume seam: entries are processed in bounded chunks,
 * progress persists through an injected checkpoint store (chrome.storage.local
 * in production, memory in tests — never module-global memory, which dies
 * with the worker), and completion is the single atomic marker write. Alarm
 * wiring follows the existing table (alarmRegistry.ts): a short-interval
 * resume tick re-invokes runDigestBatch until the marker exists, so a kill
 * resumes within minutes, not next Monday. The recording pipeline is never
 * touched: no shared mutex, no shared keys.
 */

export interface DigestBatchEntry {
  id: number;
  summary: string;
}

export interface DigestBatchCheckpoint {
  periodKey: string;
  nextIndex: number;
  processedIds: number[];
}

export interface DigestCheckpointStore {
  loadCheckpoint(): Promise<DigestBatchCheckpoint | null>;
  saveCheckpoint(checkpoint: DigestBatchCheckpoint): Promise<void>;
  loadCompletedPeriod(): Promise<string | null>;
  saveCompletedPeriod(periodKey: string): Promise<void>;
  clearCheckpoint(): Promise<void>;
}

export interface DigestBatchRunnerOptions {
  store: DigestCheckpointStore;
  /** Entries for the period, frozen at batch start (oldest first). */
  entries: DigestBatchEntry[];
  periodKey: string;
  /** Max entries digested per invocation (one alarm tick = one call). */
  chunkSize: number;
  /** Fold one entry into the running digest; pure except for its args. */
  foldEntry: (digest: string, entry: DigestBatchEntry) => string;
  /** Persist the finished digest (Daily Note append / download). */
  publishDigest: (periodKey: string, digest: string, count: number) => Promise<boolean>;
  /** True once a newer run started or the host was torn down. */
  isStale?: () => boolean;
}

export interface DigestBatchResult {
  completed: boolean;
  processedTotal: number;
}

/**
 * Runs one resumable chunk. Idempotent: a stored completion marker for the
 * same periodKey short-circuits to completed without touching entries;
 * a checkpoint for another periodKey is discarded (a new period started).
 *
 * Scaling note: the running digest is rebuilt by refolding entries
 * 0..nextIndex on every resumed tick (the checkpoint stores ids, not the
 * partial digest, so no quota-sized blob ever lands in storage.local).
 * Cost per tick is O(entries) folds; keep chunkSize >= 200 so a 10k-entry
 * period resumes in ~50 ticks of ~10k cheap folds, not thousands of ticks.
 */
export async function runDigestBatch(options: DigestBatchRunnerOptions): Promise<DigestBatchResult> {
  const { store, entries, periodKey, chunkSize, foldEntry, publishDigest } = options;
  const isStale = options.isStale ?? ((): boolean => false);

  const completedPeriod = await store.loadCompletedPeriod();
  if (completedPeriod === periodKey) {
    return { completed: true, processedTotal: entries.length };
  }

  const saved = await store.loadCheckpoint();
  let nextIndex = 0;
  let digest = '';
  const processedIds: number[] = [];
  if (saved !== null && saved.periodKey === periodKey) {
    nextIndex = saved.nextIndex;
    processedIds.push(...saved.processedIds);
    for (let i = 0; i < saved.nextIndex; i++) {
      const entry = entries[i];
      if (entry !== undefined) digest = foldEntry(digest, entry);
    }
  }

  const end = Math.min(nextIndex + Math.max(1, chunkSize), entries.length);
  for (let i = nextIndex; i < end; i++) {
    if (isStale()) {
      await store.saveCheckpoint({ periodKey, nextIndex: i, processedIds: [...processedIds] });
      return { completed: false, processedTotal: processedIds.length };
    }
    const entry = entries[i];
    if (entry === undefined) continue;
    digest = foldEntry(digest, entry);
    processedIds.push(entry.id);
  }

  if (end >= entries.length) {
    if (isStale()) {
      await store.saveCheckpoint({ periodKey, nextIndex: end, processedIds: [...processedIds] });
      return { completed: false, processedTotal: processedIds.length };
    }
    const published = await publishDigest(periodKey, digest, processedIds.length);
    if (!published) {
      await store.saveCheckpoint({ periodKey, nextIndex: end, processedIds: [...processedIds] });
      return { completed: false, processedTotal: processedIds.length };
    }
    await store.saveCompletedPeriod(periodKey);
    await store.clearCheckpoint();
    return { completed: true, processedTotal: processedIds.length };
  }

  await store.saveCheckpoint({ periodKey, nextIndex: end, processedIds: [...processedIds] });
  return { completed: false, processedTotal: processedIds.length };
}
