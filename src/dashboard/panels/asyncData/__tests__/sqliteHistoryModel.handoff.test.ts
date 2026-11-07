/**
 * sqliteHistoryModel.handoff.test.ts (PBI 2026-11-02-03)
 * Custom-range tracking: the model remembers an ephemeral since/until range
 * so the history → collection handoff can refuse it instead of silently
 * dropping to a single day. Every listing query that does not carry the
 * range clears it, so state never lies about what the list shows.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSqliteHistoryModel } from '../sqliteHistoryModel.js';
import {
  registerCollectionDraftApplier,
  consumePendingHistoryHandoff,
  clearHistoryHandoffForTests,
} from '../historyHandoff.js';

afterEach(() => {
  clearHistoryHandoffForTests();
});

function createModel() {
  const queryHistory = vi.fn().mockResolvedValue({ data: { rows: [], total: 0 } });
  return { model: createSqliteHistoryModel({ queryHistory }), queryHistory };
}

describe('sqliteHistoryModel — custom range (handoff guard)', () => {
  it('starts with no custom range', () => {
    const { model } = createModel();
    expect(model.getState().customRange).toBeNull();
  });

  it('selectDateRange records the range and clears the single date', () => {
    const { model } = createModel();
    model.selectDateRange(100, 200);
    const state = model.getState();
    expect(state.customRange).toEqual({ since: 100, until: 200 });
    expect(state.selectedDate).toBeNull();
  });

  it('selectDate clears the custom range', () => {
    const { model } = createModel();
    model.selectDateRange(100, 200);
    void model.selectDate('2026-11-02');
    expect(model.getState().customRange).toBeNull();
    expect(model.getState().selectedDate).toBe('2026-11-02');
  });

  it('search clears the custom range (the search query carries no since/until)', () => {
    const { model } = createModel();
    model.selectDateRange(100, 200);
    model.search('wasm');
    expect(model.getState().customRange).toBeNull();
    expect(model.getState().searchQuery).toBe('wasm');
  });

  it('filterByTag clears the custom range (the tag query carries the single day only)', () => {
    const { model } = createModel();
    model.selectDateRange(100, 200);
    model.filterByTag('tools');
    expect(model.getState().customRange).toBeNull();
    expect(model.getState().activeTagFilter).toBe('tools');
  });

  it('clearAllFilters clears the custom range', () => {
    const { model } = createModel();
    model.selectDateRange(100, 200);
    model.clearAllFilters();
    expect(model.getState().customRange).toBeNull();
  });

  it('restoreCollectionToDraft leaves the custom range alone (draft handoff carries no range)', () => {
    const { model, queryHistory } = createModel();
    model.selectDateRange(100, 200);
    // selectDateRange itself fetches synchronously; clear it so the assertion
    // below pins only the restore path (which must never fetch).
    queryHistory.mockClear();
    const result = model.restoreCollectionToDraft({ search: 'wasm' });
    expect(result.ok).toBe(true);
    expect(model.getState().customRange).toEqual({ since: 100, until: 200 });
    expect(queryHistory).not.toHaveBeenCalled();
  });
});

describe('sqliteHistoryModel — restoreCollectionToDraft (PBI 18 migrate-on-read)', () => {
  it('delivers a v1 save to the registered draft applier without fetching', () => {
    const { model, queryHistory } = createModel();
    const applier = vi.fn();
    registerCollectionDraftApplier(applier);

    const result = model.restoreCollectionToDraft({ search: 'wasm', tag: 'tools', date: '2026-11-02' });

    expect(result).toEqual({
      ok: true,
      where: 'applied',
      query: { search: 'wasm', tag: 'tools', date: '2026-11-02' },
    });
    expect(applier).toHaveBeenCalledWith({ search: 'wasm', tag: 'tools', date: '2026-11-02' });
    // Migrate-on-read never paints the list: no fetch, no state touch.
    expect(queryHistory).not.toHaveBeenCalled();
    expect(model.getState().searchQuery).toBe('');
    expect(model.getState().activeTagFilter).toBeNull();
  });

  it('stashes the migrated query as pending when no draft applier is registered', () => {
    const { model } = createModel();

    const result = model.restoreCollectionToDraft({ search: 'wasm' });

    expect(result).toEqual({ ok: true, where: 'pending', query: { search: 'wasm' } });
    expect(consumePendingHistoryHandoff()).toEqual({ search: 'wasm' });
    expect(consumePendingHistoryHandoff()).toBeNull();
  });

  it('refuses corrupt and empty saves fail-closed without touching the bus', () => {
    const { model } = createModel();
    for (const raw of [undefined, null, 'not-a-query', 42, {}, { evil: '<script>', search: 42 }]) {
      expect(() => model.restoreCollectionToDraft(raw)).not.toThrow();
      expect(model.restoreCollectionToDraft(raw)).toEqual({ ok: false, reason: 'empty' });
    }
    expect(consumePendingHistoryHandoff()).toBeNull();
  });
});
