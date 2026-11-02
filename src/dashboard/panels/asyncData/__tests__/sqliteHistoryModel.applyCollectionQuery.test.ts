/**
 * sqliteHistoryModel.applyCollectionQuery.test.ts
 * PBI 2026-11-02-07 — v2 collection execution paints the history list.
 *
 * Pins: the merged set lands in state with the combined total, paging
 * slices from the cached set without re-running the fan-out, cap warnings
 * stay in state until a filter change leaves collection mode, a relevance
 * sort request coerces to created_at, deleted-missing pins never error,
 * and a failed clause query surfaces as a load error.
 */
import { describe, it, expect, vi } from 'vitest';
import { createSqliteHistoryModel } from '../sqliteHistoryModel.js';
import { SQLITE_HISTORY_PAGE_SIZE } from '../sqliteHistoryModel.js';
import type { BrowsingLogEntry } from '../sqliteHistoryQuery.js';
import { MAX_COLLECTION_FANOUT } from '../../../../utils/limits.js';

function makeRow(id: number, createdAt = 1700000000000 + id * 1000): BrowsingLogEntry {
  return { id, url: `https://example.com/${id}`, title: `Example ${id}`, created_at: createdAt };
}

function clauseQuery(rowsBySearch: Record<string, BrowsingLogEntry[]>) {
  return vi.fn(async (options: { search?: string }) => ({
    data: {
      rows: (options.search !== undefined ? rowsBySearch[options.search] : Object.values(rowsBySearch).flat()) ?? [],
      total: 0,
    },
  }));
}

function orQuery(searches: string[], ids: number[] = []) {
  return {
    version: 2,
    op: 'or',
    clauses: searches.map((search) => ({ search, tag: null, date: null })),
    ids,
  };
}

describe('sqliteHistoryModel', () => {
  describe('applyCollectionQuery', () => {
    it('paints the merged rows with the combined total and clears single-condition state', async () => {
      const queryHistory = clauseQuery({ alpha: [makeRow(1), makeRow(2)], beta: [makeRow(2), makeRow(3)] });
      const model = createSqliteHistoryModel({ queryHistory: queryHistory as never });
      model.filterByTag('old-tag');

      await model.applyCollectionQuery(orQuery(['alpha', 'beta']));

      const state = model.getState();
      expect(state.entries.map((e) => e.id)).toEqual([3, 2, 1]);
      expect(state.total).toBe(3);
      expect(state.searchQuery).toBe('');
      expect(state.activeTagFilter).toBeNull();
      expect(state.selectedDate).toBeNull();
      expect(state.currentPage).toBe(0);
      expect(state.collectionWarning).toBeNull();
      expect(state.loading).toBe(false);
    });

    it('pages from the cached set without re-running the fan-out', async () => {
      const alpha = Array.from({ length: 15 }, (_, i) => makeRow(i + 1));
      const beta = Array.from({ length: 15 }, (_, i) => makeRow(i + 11));
      const queryHistory = clauseQuery({ alpha, beta });
      const model = createSqliteHistoryModel({ queryHistory: queryHistory as never });

      await model.applyCollectionQuery(orQuery(['alpha', 'beta']));
      expect(model.getState().entries).toHaveLength(SQLITE_HISTORY_PAGE_SIZE);
      expect(model.getState().total).toBe(25);
      const fanOutCalls = queryHistory.mock.calls.length;

      model.changePage(1);

      expect(model.getState().entries.map((e) => e.id)).toEqual([5, 4, 3, 2, 1]);
      expect(model.getState().total).toBe(25);
      expect(queryHistory.mock.calls.length).toBe(fanOutCalls);
    });

    it('keeps the warning in state and leaves collection mode on a filter change', async () => {
      const queryHistory = clauseQuery({ alpha: [makeRow(1)] });
      const model = createSqliteHistoryModel({ queryHistory: queryHistory as never });
      const clauses = Array.from({ length: MAX_COLLECTION_FANOUT + 1 }, (_, i) => `term-${i}`);

      await model.applyCollectionQuery(orQuery(clauses));

      expect(model.getState().collectionWarning).toMatchObject({ fanoutCapped: true, totalClauses: MAX_COLLECTION_FANOUT + 1 });
      expect(queryHistory).toHaveBeenCalledTimes(1);

      model.clearAllFilters();

      expect(model.getState().collectionWarning).toBeNull();
      // Leaving collection mode returns to query-driven fetching.
      model.changePage(1);
      expect(queryHistory.mock.calls.length).toBeGreaterThan(1);
    });

    it('coerces a relevance sort to created_at while the collection drives the list', async () => {
      const queryHistory = clauseQuery({ alpha: [makeRow(1, 1000), makeRow(2, 3000), makeRow(3, 2000)] });
      const model = createSqliteHistoryModel({ queryHistory: queryHistory as never });

      await model.applyCollectionQuery(orQuery(['alpha']));
      expect(model.getState().entries.map((e) => e.id)).toEqual([2, 3, 1]);

      await model.changeSort('relevance', 'ASC');

      const state = model.getState();
      expect(state.sortBy).toBe('created_at');
      expect(state.entries.map((e) => e.id)).toEqual([1, 3, 2]);
    });

    it('excludes deleted-missing pins without failing', async () => {
      const queryHistory = clauseQuery({ alpha: [makeRow(1)] });
      const model = createSqliteHistoryModel({ queryHistory: queryHistory as never });

      await model.applyCollectionQuery(orQuery(['alpha'], [1, 999]));

      const state = model.getState();
      expect(state.entries.map((e) => e.id)).toEqual([1]);
      expect(state.total).toBe(1);
      expect(state.error).toBeNull();
    });

    it('surfaces a failed clause query as a load error', async () => {
      const queryHistory = vi.fn(async () => ({ error: 'historyLoadError' }));
      const model = createSqliteHistoryModel({ queryHistory: queryHistory as never });

      await model.applyCollectionQuery(orQuery(['alpha']));

      expect(model.getState().error).toBe('historyLoadError');
      expect(model.getState().entries).toEqual([]);
    });

    it('notifies subscribers when the collection lands', async () => {
      const queryHistory = clauseQuery({ alpha: [makeRow(1)] });
      const model = createSqliteHistoryModel({ queryHistory: queryHistory as never });
      const listener = vi.fn();
      model.subscribe(listener);

      await model.applyCollectionQuery(orQuery(['alpha']));

      expect(listener).toHaveBeenCalled();
    });
  });
});
