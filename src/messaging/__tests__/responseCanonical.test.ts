/**
 * responseCanonical.test.ts
 * PBI 2026-11-02-02 — V2 scope normalization for ASK_HISTORY.
 * Pins: legacy v1 migration to a single clause, multi-clause/op/ids
 * passthrough, per-clause search-text trimming, and the fail-closed latch
 * for queries with nothing enforceable.
 */
import { describe, it, expect } from 'vitest';
import { normalizeCollectionScope, normalizeReportScope } from '../responseCanonical.js';
import { MAX_QUERY_IDS } from '../../utils/limits.js';

describe('responseCanonical', () => {
  describe('normalizeCollectionScope', () => {
    it('returns an unscoped scope for a null (unknown) collection', () => {
      expect(normalizeCollectionScope(null)).toEqual({
        op: 'and',
        clauses: [],
        ids: [],
        unresolvable: false,
        searchDropped: false,
      });
    });

    it('migrates a legacy v1 shape to a single clause', () => {
      const scope = normalizeCollectionScope({ tag: 'tools', date: null });
      expect(scope.unresolvable).toBe(false);
      expect(scope.clauses).toEqual([{ tag: 'tools', date: null }]);
      expect(scope.ids).toEqual([]);
    });

    it('keeps a legacy v1 tag/date pair working as one clause', () => {
      const scope = normalizeCollectionScope({ tag: 'tools', date: '2026-10-23' });
      expect(scope.unresolvable).toBe(false);
      expect(scope.clauses).toEqual([{ tag: 'tools', date: '2026-10-23' }]);
    });

    it('reads multi-clause queries with op and ids', () => {
      const scope = normalizeCollectionScope({
        version: 2,
        op: 'or',
        clauses: [{ tag: 'rust' }, { date: '2026-10-23' }],
        ids: [3],
      });
      expect(scope).toEqual({
        op: 'or',
        clauses: [{ tag: 'rust', date: null }, { tag: null, date: '2026-10-23' }],
        ids: [3],
        unresolvable: false,
        searchDropped: false,
      });
    });

    it('drops per-clause search text but keeps the enforceable remainder', () => {
      const scope = normalizeCollectionScope({ search: 'wasm', tag: 'tools' });
      expect(scope.unresolvable).toBe(false);
      expect(scope.clauses).toEqual([{ tag: 'tools', date: null }]);
    });

    it('fails closed on a query with nothing enforceable', () => {
      expect(normalizeCollectionScope({ search: 'wasm' }).unresolvable).toBe(true);
      expect(normalizeCollectionScope({}).unresolvable).toBe(true);
      expect(normalizeCollectionScope({ tag: '  ' }).unresolvable).toBe(true);
    });

    it('keeps non-finite ids out of the pin list', () => {
      const scope = normalizeCollectionScope({ ids: [3, NaN, 'x'], tag: 'tools' });
      expect(scope.unresolvable).toBe(false);
      expect(scope.ids).toEqual([3]);
    });

    it('latches searchDropped when stored search text cannot be enforced (C-#4)', () => {
      // pins-only with a search condition: the search text is dropped, the
      // pins still answer — the handler must disclose the drop.
      const pinsOnly = normalizeCollectionScope({ search: 'wasm', ids: [5] });
      expect(pinsOnly.unresolvable).toBe(false);
      expect(pinsOnly.searchDropped).toBe(true);
      // tag/date survive while the search text is dropped.
      const tagged = normalizeCollectionScope({ search: 'wasm', tag: 'tools' });
      expect(tagged.clauses).toEqual([{ tag: 'tools', date: null }]);
      expect(tagged.searchDropped).toBe(true);
    });

    it('leaves searchDropped false when no search text was stored (C-#4)', () => {
      expect(normalizeCollectionScope(null).searchDropped).toBe(false);
      expect(normalizeCollectionScope({ tag: 'tools' }).searchDropped).toBe(false);
      expect(normalizeCollectionScope({ version: 2, op: 'or', clauses: [], ids: [5] }).searchDropped).toBe(false);
    });
  });

  describe('normalizeReportScope', () => {
    it('keeps the legacy flat fields and drops unknown or non-finite values', () => {
      expect(normalizeReportScope({ search: ' wasm ', tag: 'tools', since: 1, until: 2, bogus: true })).toEqual({
        search: 'wasm',
        tag: 'tools',
        since: 1,
        until: 2,
      });
      expect(normalizeReportScope({ search: '   ', since: NaN })).toEqual({});
    });

    it('degrades non-object inputs to the empty scope', () => {
      expect(normalizeReportScope(null)).toEqual({});
      expect(normalizeReportScope('x')).toEqual({});
    });

    it('keeps non-negative-integer ids and drops the rest (C-#8)', () => {
      expect(normalizeReportScope({ ids: [3, NaN, 'x', Infinity, 5, 1.5, -2] })).toEqual({ ids: [3, 5] });
    });

    it('caps an over-long pin list instead of rejecting it (report-side absorption)', () => {
      const ids = Array.from({ length: MAX_QUERY_IDS + 50 }, (_, i) => i + 1);
      const scope = normalizeReportScope({ ids });
      expect(scope.ids).toHaveLength(MAX_QUERY_IDS);
      expect(scope.ids?.[0]).toBe(1);
    });

    it('keeps op and normalized clauses while dropping empty ones', () => {
      const scope = normalizeReportScope({
        op: 'or',
        clauses: [{ search: ' ai ', tag: 'tools' }, { search: '   ' }, 'bogus', { since: 7, until: NaN }],
      });
      expect(scope.op).toBe('or');
      expect(scope.clauses).toEqual([{ search: 'ai', tag: 'tools' }, { since: 7 }]);
    });

    it('drops an invalid op and an empty clause list', () => {
      expect(normalizeReportScope({ op: 'xor', clauses: [] })).toEqual({});
    });
  });
});
