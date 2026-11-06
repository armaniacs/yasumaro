/**
 * sqliteHistoryModel.handoff.test.ts (PBI 2026-11-02-03)
 * Custom-range tracking: the model remembers an ephemeral since/until range
 * so the history → collection handoff can refuse it instead of silently
 * dropping to a single day. Every listing query that does not carry the
 * range clears it, so state never lies about what the list shows.
 */
import { describe, it, expect, vi } from 'vitest';
import { createSqliteHistoryModel } from '../sqliteHistoryModel.js';

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

  it('applyCollection clears the custom range (v1 carries a single day only)', () => {
    const { model } = createModel();
    model.selectDateRange(100, 200);
    model.applyCollection({ search: 'wasm' });
    expect(model.getState().customRange).toBeNull();
  });
});
