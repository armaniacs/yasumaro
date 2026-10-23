/**
 * sqliteHistoryModel.applyCollection.test.ts
 * PBI 2026-10-23-06 — saved-collection recall entry point.
 * Pins: recall lands every stored condition in state through ONE action and
 * issues ONE fetch with all of them (search + tag + day range), the current
 * sort is preserved (a collection is a named condition, not a sort choice),
 * and a corrupted query degrades to the empty condition instead of throwing.
 */
import { describe, it, expect, vi } from 'vitest';
import { createSqliteHistoryModel } from '../sqliteHistoryModel.js';
import type { BrowsingLogEntry } from '../sqliteHistoryQuery.js';

function makeRow(id: number): BrowsingLogEntry {
  return { id, url: `https://example.com/${id}`, title: `Example ${id}`, created_at: 1700000000000 + id };
}

describe('applyCollection — recall entry point (PBI 2026-10-23-06)', () => {
  it('applies search + tag + date in one dispatch and one fetch with all conditions', async () => {
    const queryHistory = vi.fn().mockResolvedValue({ data: { rows: [makeRow(1)], total: 1 } });
    const model = createSqliteHistoryModel({ queryHistory });
    model.applyCollection({ search: 'wasm', tag: 'tools', date: '2026-10-23' });
    await new Promise((r) => setTimeout(r, 0));

    const state = model.getState();
    expect(state.searchQuery).toBe('wasm');
    expect(state.activeTagFilter).toBe('tools');
    expect(state.selectedDate).toBe('2026-10-23');
    expect(state.currentPage).toBe(0);
    // localDayRangeFromDateString('2026-10-23') → the whole local day
    expect(queryHistory).toHaveBeenCalledTimes(1);
    expect(queryHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        search: 'wasm',
        tagFilter: 'tools',
        sortBy: 'created_at',
        sortDir: 'DESC',
      }),
    );
    const call = queryHistory.mock.calls[0]?.[0] as { since?: number; until?: number };
    expect(call.since).toBeTypeOf('number');
    expect(call.until).toBeTypeOf('number');
    // One inclusive local day: start-of-day to end-of-day. DST can make the
    // day 23h or 25h, so the assertion pins "at most one day, at least 23h".
    expect(call.until! > call.since!).toBe(true);
    expect(call.until! - call.since!).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    expect(call.until! - call.since!).toBeGreaterThan(23 * 60 * 60 * 1000);
  });

  it('preserves the current sort (relevance survives a recall with a search term)', async () => {
    const queryHistory = vi.fn().mockResolvedValue({ data: { rows: [], total: 0 } });
    const model = createSqliteHistoryModel({ queryHistory });
    await model.changeSort('relevance', 'ASC');
    expect(model.getState().sortBy).toBe('relevance');
    model.applyCollection({ search: 'wasm' });
    // A collection is a named condition, not a sort choice — no sort switch.
    expect(model.getState().sortBy).toBe('relevance');
    expect(model.getState().sortDir).toBe('ASC');
  });

  it('clears the tag filter and search when the collection carries none', async () => {
    const queryHistory = vi.fn().mockResolvedValue({ data: { rows: [], total: 0 } });
    const model = createSqliteHistoryModel({ queryHistory });
    model.filterByTag('old-tag');
    model.applyCollection({});
    expect(model.getState().activeTagFilter).toBeNull();
    expect(model.getState().searchQuery).toBe('');
  });

  it('degrades a corrupted query to the empty condition (縮退の出口)', async () => {
    const queryHistory = vi.fn().mockResolvedValue({ data: { rows: [], total: 0 } });
    const model = createSqliteHistoryModel({ queryHistory });
    // Test-only casts: the panel would only ever pass a stored record, so the
    // corrupted shapes are simulated here to pin the fail-closed contract.
    expect(() => model.applyCollection('not-an-object' as unknown as Record<string, unknown>)).not.toThrow();
    expect(() => model.applyCollection(undefined as unknown as Record<string, unknown>)).not.toThrow();
    model.applyCollection({ evil: '<script>', search: 42 });
    expect(model.getState().searchQuery).toBe('');
    expect(model.getState().activeTagFilter).toBeNull();
  });

  it('notifies subscribers after the state dispatch (recall paints immediately)', () => {
    const queryHistory = vi.fn().mockResolvedValue({ data: { rows: [], total: 0 } });
    const model = createSqliteHistoryModel({ queryHistory });
    const listener = vi.fn();
    model.subscribe(listener);
    model.applyCollection({ tag: 'tools' });
    expect(listener).toHaveBeenCalled();
  });
});
