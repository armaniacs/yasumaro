import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSqliteHistoryModel } from '../sqliteHistoryModel.js';
import type { UnifiedHistoryQueryResult } from '../sqliteHistoryQuery.js';
import type { BrowsingLogEntry } from '../sqliteHistoryQuery.js';

vi.mock('../../../dashboardSqliteService.js', () => ({
  queryLogs: vi.fn(),
  searchLogs: vi.fn(),
  toggleStar: vi.fn().mockResolvedValue({ data: { is_starred: 1 } }),
  deleteLog: vi.fn().mockResolvedValue({ data: {} }),
  getSqliteStatus: vi.fn().mockResolvedValue({ initialized: true, fallback: false }),
  appendToLogs: vi.fn().mockResolvedValue({ data: {} }),
  isServiceError: (result: object) => 'error' in result,
}));

vi.mock('../../../../utils/storageUrls.js', () => ({
  getSavedUrlEntries: vi.fn().mockResolvedValue([]),
  removeSavedUrl: vi.fn().mockResolvedValue(undefined),
}));

function makeRow(id: number): BrowsingLogEntry {
  return { id, url: `https://example.com/${id}`, title: `Example ${id}`, created_at: 1700000000000 + id };
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sqliteHistoryModel — LRU query cache', () => {
  it('page 0 -> 1 -> 0 uses cache for the return to 0 (queryHistory called 2x)', async () => {
    const queryHistory = vi.fn().mockImplementation(async (opts: { offset: number }) => {
      const page = opts.offset / 20;
      return { data: { rows: [makeRow(page)], total: 10 } };
    });
    const model = createSqliteHistoryModel({ queryHistory });
    const listener = vi.fn();
    model.subscribe(listener);

    await model.fetchData({ page: 0 });
    expect(queryHistory).toHaveBeenCalledTimes(1);

    await model.fetchData({ page: 1 });
    expect(queryHistory).toHaveBeenCalledTimes(2);

    listener.mockClear();
    await model.fetchData({ page: 0 });
    expect(queryHistory).toHaveBeenCalledTimes(2);
    expect(model.getState().entries.map((e) => e.id)).toEqual([0]);
    // cache hit: single notify, no loadStart flicker (listener called once, loading stays false)
    expect(listener).toHaveBeenCalledTimes(1);
    expect(model.getState().loading).toBe(false);
  });

  it('deleteEntry invalidates whole cache — next fetch re-queries', async () => {
    const queryHistory = vi.fn().mockResolvedValue({ data: { rows: [makeRow(1)], total: 1 } });
    const model = createSqliteHistoryModel({ queryHistory });

    await model.fetchData({ page: 0 });
    expect(queryHistory).toHaveBeenCalledTimes(1);

    // cache hit would avoid second call — verify hit works before mutation
    await model.fetchData({ page: 0 });
    expect(queryHistory).toHaveBeenCalledTimes(1);

    await model.deleteEntry(1);
    await model.fetchData({ page: 0 });
    expect(queryHistory).toHaveBeenCalledTimes(2);
  });

  it('LRU cap evicts oldest entry beyond 20', async () => {
    const queryHistory = vi.fn().mockImplementation(async (opts: { offset: number }) => {
      const page = opts.offset / 20;
      return { data: { rows: [makeRow(page)], total: 100 } };
    });
    const model = createSqliteHistoryModel({ queryHistory });

    for (let p = 0; p < 21; p++) {
      await model.fetchData({ page: p });
    }
    expect(queryHistory).toHaveBeenCalledTimes(21);

    // page 0 was the oldest (first inserted) and should have been evicted
    await model.fetchData({ page: 0 });
    expect(queryHistory).toHaveBeenCalledTimes(22);

    // page 1 should also have been evicted after inserting page 0 again? Actually LRU after 21 inserts: cache contains pages 1..20. Then fetching 0 evicts 1. So next fetch 20 should still be cached.
    // Verify that the most recent page (20) is still cached
    await model.fetchData({ page: 20 });
    expect(queryHistory).toHaveBeenCalledTimes(22);
  });

  it('stale response (generation mismatch) is not cached', async () => {
    const stale = deferred<UnifiedHistoryQueryResult>();
    const newer = deferred<UnifiedHistoryQueryResult>();
    const queryHistory = vi
      .fn()
      .mockImplementationOnce(() => stale.promise)
      .mockImplementationOnce(() => newer.promise)
      .mockImplementation(async (opts: { offset: number }) => {
        const page = opts.offset / 20;
        return { data: { rows: [makeRow(page)], total: 10 } };
      });

    const model = createSqliteHistoryModel({ queryHistory });

    const first = model.fetchData({ page: 0 });
    const second = model.fetchData({ page: 1 });
    newer.resolve({ data: { rows: [makeRow(99)], total: 1 } });
    await second;
    expect(model.getState().entries.map((e) => e.id)).toEqual([99]);

    stale.resolve({ data: { rows: [makeRow(1)], total: 1 } });
    await first;
    // stale result must not overwrite newer state
    expect(model.getState().entries.map((e) => e.id)).toEqual([99]);

    // page 0 should not be cached (stale was not stored), so next fetch must call queryHistory again
    const callsBefore = queryHistory.mock.calls.length;
    await model.fetchData({ page: 0 });
    expect(queryHistory.mock.calls.length).toBe(callsBefore + 1);
  });

  it('normalizes empty search and undefined tagFilter to same cache key', async () => {
    const queryHistory = vi.fn().mockResolvedValue({ data: { rows: [makeRow(1)], total: 1 } });
    const model = createSqliteHistoryModel({ queryHistory });

    await model.fetchData({ page: 0, search: '' });
    expect(queryHistory).toHaveBeenCalledTimes(1);
    await model.fetchData({ page: 0, search: undefined });
    expect(queryHistory).toHaveBeenCalledTimes(1);

    await model.fetchData({ page: 0, tagFilter: '' });
    expect(queryHistory).toHaveBeenCalledTimes(1);
    await model.fetchData({ page: 0, tagFilter: undefined });
    expect(queryHistory).toHaveBeenCalledTimes(1);
  });

  it('clears cache on onNavigateOut — next fetch re-queries', async () => {
    const queryHistory = vi.fn().mockResolvedValue({ data: { rows: [makeRow(1)], total: 1 } });
    const model = createSqliteHistoryModel({ queryHistory });

    await model.fetchData({ page: 0 });
    expect(queryHistory).toHaveBeenCalledTimes(1);
    model.onNavigateOut();
    await model.fetchData({ page: 0 });
    expect(queryHistory).toHaveBeenCalledTimes(2);
  });
});
