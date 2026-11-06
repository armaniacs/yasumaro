/**
 * savedCollectionQuery.test.ts
 * PBI 2026-10-23-06 — pure condition-shape logic for named saved collections.
 * Pins: serialize stores exactly what panel state holds, an unknown stored
 * shape fails closed to the empty condition (縮退の出口), and the describe
 * summary joins the present conditions only.
 */
import { describe, it, expect } from 'vitest';
import { MAX_QUERY_IDS, MAX_SEARCH_QUERY_LENGTH } from '../../../../utils/limits.js';
import {
  serializeCollectionQuery,
  hasCollectionCondition,
  parseCollectionQuery,
  describeCollectionQuery,
  newCollectionId,
  parseCollectionQueryV2,
  serializeClausesQuery,
  describeCollectionQueryV2,
} from '../savedCollectionQuery.js';

const LABELS = { search: '語', tag: 'タグ', date: '期間' };

describe('serializeCollectionQuery', () => {
  it('stores search, tag and date when all are present', () => {
    const query = serializeCollectionQuery({
      searchQuery: '  wasm  ',
      activeTagFilter: 'tools',
      selectedDate: '2026-10-23',
    });
    expect(query).toEqual({ search: 'wasm', tag: 'tools', date: '2026-10-23' });
  });

  it('omits empty fields instead of storing empty strings', () => {
    const query = serializeCollectionQuery({
      searchQuery: '',
      activeTagFilter: null,
      selectedDate: null,
    });
    expect(query).toEqual({});
    expect(hasCollectionCondition(query)).toBe(false);
  });

  it('trims whitespace-only fields away (fail closed)', () => {
    const query = serializeCollectionQuery({
      searchQuery: '   ',
      activeTagFilter: '  ',
      selectedDate: '\t',
    });
    expect(query).toEqual({});
  });
});

describe('hasCollectionCondition', () => {
  it('is true for any single stored condition', () => {
    expect(hasCollectionCondition({ tag: 'x' })).toBe(true);
    expect(hasCollectionCondition({ search: 'y' })).toBe(true);
    expect(hasCollectionCondition({ date: '2026-10-23' })).toBe(true);
  });
});

describe('parseCollectionQuery', () => {
  it('round-trips a serialized query', () => {
    const raw = serializeCollectionQuery({
      searchQuery: 'wasm',
      activeTagFilter: 'tools',
      selectedDate: '2026-10-23',
    });
    expect(parseCollectionQuery(raw)).toEqual({
      search: 'wasm',
      tag: 'tools',
      date: '2026-10-23',
    });
  });

  it('fails closed to the empty condition on unknown shapes (縮退の出口)', () => {
    expect(parseCollectionQuery(undefined)).toEqual({ search: '', tag: null, date: null });
    expect(parseCollectionQuery(null)).toEqual({ search: '', tag: null, date: null });
    expect(parseCollectionQuery('not-an-object')).toEqual({ search: '', tag: null, date: null });
    expect(parseCollectionQuery(42)).toEqual({ search: '', tag: null, date: null });
  });

  it('keeps unknown extra keys out of the parsed shape', () => {
    const parsed = parseCollectionQuery({ search: 'wasm', evil: '<script>' });
    expect(parsed).toEqual({ search: 'wasm', tag: null, date: null });
    expect(Object.keys(parsed)).toEqual(['search', 'tag', 'date']);
  });
});

describe('describeCollectionQuery', () => {
  it('joins the present conditions in field order', () => {
    const summary = describeCollectionQuery(
      { search: 'wasm', tag: 'tools', date: '2026-10-23' },
      LABELS,
    );
    expect(summary).toBe('語: wasm / タグ: tools / 期間: 2026-10-23');
  });

  it('returns the empty string when no condition parsed', () => {
    expect(describeCollectionQuery({}, LABELS)).toBe('');
    expect(describeCollectionQuery(null, LABELS)).toBe('');
  });
});

describe('newCollectionId', () => {
  it('returns a non-empty id and differs across calls in the same millisecond', () => {
    const a = newCollectionId(1700000000000);
    const b = newCollectionId(1700000000000);
    expect(a).not.toBe('');
    expect(b).not.toBe('');
    expect(a).not.toBe(b);
  });
});

describe('savedCollectionQuery v2', () => {
  describe('parseCollectionQueryV2', () => {
    it('parses multi-clause queries with op', () => {
      const parsed = parseCollectionQueryV2({
        version: 2,
        op: 'or',
        clauses: [
          { search: 'AI', tag: 'tools', date: null },
          { search: '要約', tag: null, date: '2026-11-01' },
        ],
      });
      expect(parsed.clauses).toHaveLength(2);
      expect(parsed.op).toBe('or');
    });
    it('migrates legacy v1 shape to single-clause v2', () => {
      const parsed = parseCollectionQueryV2({ search: 'wasm', tag: 'tools', date: null });
      expect(parsed.clauses).toEqual([{ search: 'wasm', tag: 'tools', date: null }]);
      expect(parsed.op).toBe('and');
    });
    it('fails closed to empty clauses on unknown shapes', () => {
      expect(parseCollectionQueryV2(null).clauses).toEqual([]);
      expect(parseCollectionQueryV2('x').clauses).toEqual([]);
    });
    it('truncates over-long id lists to MAX_QUERY_IDS', () => {
      const ids = Array.from({ length: MAX_QUERY_IDS + 50 }, (_, i) => i);
      const parsed = parseCollectionQueryV2({ version: 2, op: 'or', clauses: [], ids });
      expect(parsed.ids).toHaveLength(MAX_QUERY_IDS);
      expect(parsed.ids).toEqual(ids.slice(0, MAX_QUERY_IDS));
    });
    it('drops float, negative, NaN and non-number ids (no DB row can match them)', () => {
      const parsed = parseCollectionQueryV2({
        version: 2,
        op: 'or',
        clauses: [],
        ids: [1, 1.5, -2, NaN, Infinity, '3', null, 4],
      });
      expect(parsed.ids).toEqual([1, 4]);
    });
    it('truncates over-long clause strings to MAX_SEARCH_QUERY_LENGTH (S-#4)', () => {
      const long = 'x'.repeat(MAX_SEARCH_QUERY_LENGTH + 500);
      const parsed = parseCollectionQueryV2({
        version: 2,
        op: 'or',
        clauses: [{ search: long, tag: long, date: '2026-11-01' }],
        ids: [],
      });
      expect(parsed.clauses).toHaveLength(1);
      expect(parsed.clauses[0]?.search).toHaveLength(MAX_SEARCH_QUERY_LENGTH);
      expect(parsed.clauses[0]?.tag).toHaveLength(MAX_SEARCH_QUERY_LENGTH);
      // Short inputs are untouched; the date shape is unaffected by the cap.
      const short = parseCollectionQueryV2({ search: 'wasm', tag: 'tools', date: '2026-11-01' });
      expect(short.clauses).toEqual([{ search: 'wasm', tag: 'tools', date: '2026-11-01' }]);
    });
  });
});
