/**
 * collectionHistoryQuery.test.ts
 * PBI 2026-11-02-07 — v2 collection execution for the history list.
 *
 * Pins: per-clause fan-out through the injected queryHistory, UNION merge
 * (or) / intersection (and), first-clause-only past MAX_COLLECTION_FANOUT,
 * slice to MAX_COLLECTION_ROWS with a truncation warning, deleted-missing
 * pins excluded without error, created_at ordering (relevance never
 * applied), and error propagation on a failed clause query.
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveCollectionHistory } from '../collectionHistoryQuery.js';
import type { UnifiedHistoryQueryOptions } from '../sqliteHistoryQuery.js';
import type { BrowsingLogEntry } from '../sqliteHistoryQuery.js';
import { MAX_COLLECTION_FANOUT, MAX_COLLECTION_ROWS } from '../../../../utils/limits.js';

function makeRow(id: number, createdAt = 1700000000000 + id * 1000): BrowsingLogEntry {
  return { id, url: `https://example.com/${id}`, title: `Example ${id}`, created_at: createdAt };
}

type QueryFn = (options: UnifiedHistoryQueryOptions) => Promise<{ data: { rows: BrowsingLogEntry[]; total: number } } | { error: string }>;

function rowsResult(rows: BrowsingLogEntry[]): { data: { rows: BrowsingLogEntry[]; total: number } } {
  return { data: { rows, total: rows.length } };
}

describe('collectionHistoryQuery', () => {
  describe('resolveCollectionHistory', () => {
    it('fans out one query per clause and unions the ids for or', async () => {
      const runQuery = vi.fn<QueryFn>(async (options) => {
        if (options.search === 'alpha') return rowsResult([makeRow(1), makeRow(2)]);
        if (options.search === 'beta') return rowsResult([makeRow(2), makeRow(3)]);
        return rowsResult([]);
      });
      const query = { version: 2, op: 'or', clauses: [{ search: 'alpha', tag: null, date: null }, { search: 'beta', tag: null, date: null }], ids: [] };

      const outcome = await resolveCollectionHistory(query, runQuery as never);

      expect(runQuery).toHaveBeenCalledTimes(2);
      expect(runQuery).toHaveBeenCalledWith(expect.objectContaining({ search: 'alpha' }));
      expect(runQuery).toHaveBeenCalledWith(expect.objectContaining({ search: 'beta' }));
      expect(outcome).toEqual({
        data: {
          rows: [makeRow(3), makeRow(2), makeRow(1)],
          total: 3,
          warning: null,
        },
      });
    });

    it('intersects the id sets for and', async () => {
      const runQuery = vi.fn<QueryFn>(async (options) => {
        if (options.search === 'alpha') return rowsResult([makeRow(1), makeRow(2)]);
        return rowsResult([makeRow(2), makeRow(3)]);
      });
      const query = { version: 2, op: 'and', clauses: [{ search: 'alpha', tag: null, date: null }, { search: 'other', tag: null, date: null }], ids: [] };

      const outcome = await resolveCollectionHistory(query, runQuery as never);

      expect(outcome).toEqual({ data: { rows: [makeRow(2)], total: 1, warning: null } });
    });

    it('unions pinned ids with the clause results', async () => {
      const runQuery = vi.fn<QueryFn>(async (options) => {
        // Clause fan-out returns row 1; the pin-cover re-fetch (no search)
        // carries the pinned row 7.
        if (options.search === 'alpha') return rowsResult([makeRow(1)]);
        return rowsResult([makeRow(7)]);
      });
      const query = { version: 2, op: 'or', clauses: [{ search: 'alpha', tag: null, date: null }], ids: [1, 7] };

      const outcome = await resolveCollectionHistory(query, runQuery as never);

      expect(runQuery).toHaveBeenCalledTimes(2);
      expect(outcome).toEqual({
        data: { rows: [makeRow(7), makeRow(1)], total: 2, warning: null },
      });
    });

    it('runs only the first clause past the fan-out cap and warns', async () => {
      const runQuery = vi.fn<QueryFn>(async () => rowsResult([makeRow(1)]));
      const clauses = Array.from({ length: MAX_COLLECTION_FANOUT + 1 }, (_, i) => ({
        search: `term-${i}`, tag: null, date: null,
      }));
      const query = { version: 2, op: 'or', clauses, ids: [] };

      const outcome = await resolveCollectionHistory(query, runQuery as never);

      expect(runQuery).toHaveBeenCalledTimes(1);
      expect(runQuery).toHaveBeenCalledWith(expect.objectContaining({ search: 'term-0' }));
      expect(outcome).toEqual({
        data: {
          rows: [makeRow(1)],
          total: 1,
          warning: {
            fanoutCapped: true,
            totalClauses: MAX_COLLECTION_FANOUT + 1,
            truncated: false,
            shownCount: 1,
            fullCount: 1,
          },
        },
      });
    });

    it('slices the merged set to the row cap and warns', async () => {
      const runQuery = vi.fn<QueryFn>(async () => rowsResult(
        Array.from({ length: MAX_COLLECTION_ROWS + 5 }, (_, i) => makeRow(i + 1)),
      ));
      const query = { version: 2, op: 'or', clauses: [{ search: 'alpha', tag: null, date: null }], ids: [] };

      const outcome = await resolveCollectionHistory(query, runQuery as never);

      expect(outcome).toMatchObject({
        data: {
          total: MAX_COLLECTION_ROWS,
          warning: {
            fanoutCapped: false,
            truncated: true,
            shownCount: MAX_COLLECTION_ROWS,
            fullCount: MAX_COLLECTION_ROWS + 5,
          },
        },
      });
      if ('data' in outcome) {
        expect(outcome.data.rows).toHaveLength(MAX_COLLECTION_ROWS);
        expect(outcome.data.rows[0]?.id).toBe(MAX_COLLECTION_ROWS + 5);
      }
    });

    it('excludes deleted-missing pins instead of failing', async () => {
      const runQuery = vi.fn<QueryFn>(async () => rowsResult([makeRow(1)]));
      const query = { version: 2, op: 'or', clauses: [{ search: 'alpha', tag: null, date: null }], ids: [1, 999] };

      const outcome = await resolveCollectionHistory(query, runQuery as never);

      // id 999 appears in no clause result and no pin-cover row: excluded.
      expect(outcome).toEqual({ data: { rows: [makeRow(1)], total: 1, warning: null } });
    });

    it('orders by created_at in both directions and never by relevance', async () => {
      const runQuery = vi.fn<QueryFn>(async () => rowsResult([
        makeRow(1, 3000),
        makeRow(2, 1000),
        makeRow(3, 2000),
      ]));
      const query = { version: 2, op: 'or', clauses: [{ search: 'alpha', tag: null, date: null }], ids: [] };

      const desc = await resolveCollectionHistory(query, runQuery as never);
      const asc = await resolveCollectionHistory(query, runQuery as never, { sortDir: 'ASC' });

      expect(desc).toMatchObject({ data: { rows: [makeRow(1, 3000), makeRow(3, 2000), makeRow(2, 1000)] } });
      expect(asc).toMatchObject({ data: { rows: [makeRow(2, 1000), makeRow(3, 2000), makeRow(1, 3000)] } });
      for (const call of runQuery.mock.calls) {
        expect(call[0]).toMatchObject({ sortBy: 'created_at' });
        expect(call[0]).not.toMatchObject({ sortBy: 'relevance' });
      }
    });

    it('reads tag and day clauses into storage options', async () => {
      const runQuery = vi.fn<QueryFn>(async () => rowsResult([]));
      const query = {
        version: 2, op: 'and',
        clauses: [{ search: '', tag: 'tools', date: '2026-10-23' }],
        ids: [],
      };

      await resolveCollectionHistory(query, runQuery as never);

      expect(runQuery).toHaveBeenCalledWith(expect.objectContaining({ tagFilter: 'tools' }));
      const call = runQuery.mock.calls[0]?.[0] as UnifiedHistoryQueryOptions;
      expect(call.since).toBeTypeOf('number');
      expect(call.until).toBeTypeOf('number');
    });

    it('propagates a failed clause query instead of showing a partial list', async () => {
      const runQuery = vi.fn<QueryFn>(async () => ({ error: 'historyLoadError' }));
      const query = { version: 2, op: 'or', clauses: [{ search: 'alpha', tag: null, date: null }], ids: [] };

      const outcome = await resolveCollectionHistory(query, runQuery as never);

      expect(outcome).toEqual({ error: 'historyLoadError' });
    });

    it('reads the collapsed single-clause flat shape and fails closed on garbage', async () => {
      const runQuery = vi.fn<QueryFn>(async (options) => {
        if (options.search === 'wasm') return rowsResult([makeRow(1)]);
        return rowsResult([]);
      });

      const flat = await resolveCollectionHistory({ search: 'wasm' }, runQuery as never);
      expect(flat).toEqual({ data: { rows: [makeRow(1)], total: 1, warning: null } });

      const empty = await resolveCollectionHistory({}, runQuery as never);
      expect(empty).toEqual({ data: { rows: [], total: 0, warning: null } });
      const garbage = await resolveCollectionHistory('not-a-query', runQuery as never);
      expect(garbage).toEqual({ data: { rows: [], total: 0, warning: null } });
    });
  });
});
