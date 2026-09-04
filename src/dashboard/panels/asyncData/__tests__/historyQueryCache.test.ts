import { describe, it, expect } from 'vitest';
import { QueryCache } from '../historyQueryCache.js';
import type { UnifiedHistoryQueryData } from '../sqliteHistoryQuery.js';
import type { BrowsingLogEntry } from '../sqliteHistoryQuery.js';

function makeRow(id: number): BrowsingLogEntry {
  return { id, url: `https://example.com/${id}`, title: `Example ${id}`, created_at: 1700000000000 + id };
}

function makeData(ids: number[]): UnifiedHistoryQueryData {
  return { rows: ids.map(makeRow), total: ids.length };
}

function baseParams(overrides: Record<string, unknown> = {}): Parameters<typeof QueryCache.buildKey>[0] {
  return { sortBy: 'created_at', sortDir: 'DESC', page: 0, ...overrides };
}

describe('QueryCache', () => {
  it('evicts the oldest entry beyond cap', () => {
    const cache = new QueryCache(2);
    cache.set('a', makeData([1]));
    cache.set('b', makeData([2]));
    cache.set('c', makeData([3]));
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')?.rows.map((r) => r.id)).toEqual([2]);
    expect(cache.get('c')?.rows.map((r) => r.id)).toEqual([3]);
  });

  it('refreshes LRU order on get', () => {
    const cache = new QueryCache(2);
    cache.set('a', makeData([1]));
    cache.set('b', makeData([2]));
    expect(cache.get('a')).toBeDefined();
    cache.set('c', makeData([3]));
    expect(cache.get('a')?.rows.map((r) => r.id)).toEqual([1]);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBeDefined();
  });

  it('returns a defensive copy of rows on get', () => {
    const cache = new QueryCache();
    cache.set('a', makeData([1, 2]));
    const first = cache.get('a')!;
    first.rows.push(makeRow(99));
    const second = cache.get('a')!;
    expect(second.rows.map((r) => r.id)).toEqual([1, 2]);
    expect(second.rows).not.toBe(first.rows);
  });

  it("normalizes '' and undefined search to the same key", () => {
    const withEmpty = QueryCache.buildKey(baseParams({ search: '' }));
    const withUndefined = QueryCache.buildKey(baseParams({ search: undefined }));
    const without = QueryCache.buildKey(baseParams());
    expect(withEmpty).toBe(withUndefined);
    expect(withEmpty).toBe(without);
  });

  it('distinguishes tagInitiated', () => {
    const plain = QueryCache.buildKey(baseParams({ tagFilter: 'js' }));
    const initiated = QueryCache.buildKey(baseParams({ tagFilter: 'js', tagInitiated: true }));
    expect(plain).not.toBe(initiated);
  });

  it('clears all entries', () => {
    const cache = new QueryCache();
    cache.set('a', makeData([1]));
    cache.set('b', makeData([2]));
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
  });
});
