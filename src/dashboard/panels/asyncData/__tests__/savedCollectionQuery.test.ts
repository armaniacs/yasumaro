/**
 * savedCollectionQuery.test.ts
 * PBI 2026-10-23-06 — pure condition-shape logic for named saved collections.
 * Pins: serialize stores exactly what panel state holds, an unknown stored
 * shape fails closed to the empty condition (縮退の出口), and the describe
 * summary joins the present conditions only.
 */
import { describe, it, expect } from 'vitest';
import {
  serializeCollectionQuery,
  hasCollectionCondition,
  parseCollectionQuery,
  describeCollectionQuery,
  newCollectionId,
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
