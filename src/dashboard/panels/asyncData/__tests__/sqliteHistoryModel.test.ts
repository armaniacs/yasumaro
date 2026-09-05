/**
 * sqliteHistoryModel.test.ts
 * PBI-17 — HistoryModel shrink integration verification.
 * Ensures generation/pendingInit/sort persistence are encapsulated in Model
 * and that Panel subscribes via model.subscribe while keeping updateDynamicRegions.
 */
import { describe, it, expect, vi } from 'vitest';
import { createSqliteHistoryModel } from '../sqliteHistoryModel.js';
import type { UnifiedHistoryQueryResult } from '../sqliteHistoryQuery.js';
import type { BrowsingLogEntry } from '../sqliteHistoryQuery.js';

function makeRow(id: number): BrowsingLogEntry {
  return { id, url: `https://example.com/${id}`, title: `Example ${id}`, created_at: 1700000000000 + id };
}
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

describe('HistoryModel — subscribe is thin alias of onStateChange', () => {
  it('sortChange completes via fetch → State → render through subscribe', async () => {
    const queryHistory = vi.fn().mockResolvedValue({ data: { rows: [makeRow(1)], total: 1 } });
    const model = createSqliteHistoryModel({ queryHistory });
    const listener = vi.fn();
    model.subscribe(listener);
    await model.changeSort('created_at', 'ASC');
    // loadStart + loadSuccess (fetchData) + sortChange path notify
    expect(listener).toHaveBeenCalled();
    expect(model.getState().sortBy).toBe('created_at');
    expect(model.getState().sortDir).toBe('ASC');
    expect(queryHistory).toHaveBeenCalledWith(expect.objectContaining({ sortBy: 'created_at', sortDir: 'ASC' }));
  });

  it('generation guard discards stale fetch via two subscribe notifications', async () => {
    const stale = deferred<UnifiedHistoryQueryResult>();
    const newer = deferred<UnifiedHistoryQueryResult>();
    const queryHistory = vi.fn().mockImplementationOnce(() => stale.promise).mockImplementationOnce(() => newer.promise);
    const model = createSqliteHistoryModel({ queryHistory });
    const states: number[][] = [];
    model.subscribe(() => states.push(model.getState().entries.map(e => e.id)));

    const first = model.fetchData({ page: 0 });
    const second = model.fetchData({ page: 0 });
    newer.resolve({ data: { rows: [makeRow(2)], total: 1 } });
    await second;
    expect(model.getState().entries.map(e => e.id)).toEqual([2]);
    stale.resolve({ data: { rows: [makeRow(1)], total: 1 } });
    await first;
    expect(model.getState().entries.map(e => e.id)).toEqual([2]);
    expect(model.getState().loading).toBe(false);
  });

  it('onNavigateIn(tag) + changeSort race keeps generation correct (no permanent spinner)', async () => {
    const first = deferred<UnifiedHistoryQueryResult>();
    const second = deferred<UnifiedHistoryQueryResult>();
    const third = deferred<UnifiedHistoryQueryResult>();
    // Call order is deterministic: navigate-in's immediate tag fetch (#1),
    // the concurrent sort fetch (#2), then navigate-in's retry fetch (#3).
    const queryHistory = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockImplementationOnce(() => third.promise);
    const model = createSqliteHistoryModel({ queryHistory });
    const nav = model.onNavigateIn({ searchTag: 'AI' });
    // concurrent sort change bumps generation again
    const sortPromise = model.changeSort('created_at', 'ASC');
    second.resolve({ data: { rows: [makeRow(1)], total: 1 } });
    await sortPromise;
    third.resolve({ data: { rows: [makeRow(2)], total: 1 } });
    await nav;
    first.resolve({ data: { rows: [makeRow(1)], total: 1 } });
    await new Promise(r => setTimeout(r, 0));
    expect(model.getState().loading).toBe(false);
    expect(model.getState().entries.map(e => e.id)).toEqual([2]);
  });

  it('unsubscribe stops notifications', async () => {
    const queryHistory = vi.fn().mockResolvedValue({ data: { rows: [], total: 0 } });
    const model = createSqliteHistoryModel({ queryHistory });
    const listener = vi.fn();
    const unsub = model.subscribe(listener);
    unsub();
    await model.fetchData({ page: 0 });
    expect(listener).not.toHaveBeenCalled();
  });
});
