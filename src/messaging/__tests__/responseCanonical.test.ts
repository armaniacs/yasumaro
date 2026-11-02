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

    it('keeps finite ids and drops non-finite entries (V2 pins)', () => {
      expect(normalizeReportScope({ ids: [3, NaN, 'x', Infinity, 5] })).toEqual({ ids: [3, 5] });
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
