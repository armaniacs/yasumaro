/**
 * SyncBatchRunner.ts
 * FOLDED (PBI 2026-10-24-05): the batch loop now lives as an internal seam of
 * gistSyncTarget.ts, its sole consumer (N=1 adapter, one hypothetical seam
 * removed). This file is kept as a tombstone so the fold stays discoverable;
 * it intentionally exports nothing.
 *
 * RE-EXTRACT CONDITION: extract a shared runner again only when a second
 * SyncTarget adapter appears and duplicates the Gist batch loop.
 */
export {};
