/**
 * lruCache-comprehensive.test.ts
 * Edge case tests for LruCache — capacity boundary, concurrent patterns,
 * deletion, overwriting, and stress scenarios.
 */

import { describe, it, expect, vi } from 'vitest';
import { LruCache } from '../lruCache.js';

describe('LruCache edge cases', () => {
  // ── Capacity edge cases ──────────────────────────────────────────────

  it('handles capacity of 1 (single entry)', () => {
    const evicted: number[] = [];
    const cache = new LruCache<number, string>(1, (k) => evicted.push(k));

    cache.set(1, 'a');
    expect(cache.size).toBe(1);
    expect(cache.get(1)).toBe('a');

    cache.set(2, 'b'); // evicts 1
    expect(evicted).toEqual([1]);
    expect(cache.get(1)).toBeUndefined();
    expect(cache.get(2)).toBe('b');
  });

  it('handles capacity of 0 (never stores)', () => {
    const evicted: number[] = [];
    const cache = new LruCache<number, string>(0, (k) => evicted.push(k));

    cache.set(1, 'a');
    expect(cache.size).toBe(0);
    expect(evicted).toEqual([]);
    expect(cache.get(1)).toBeUndefined();
  });

  it('handles very large capacity', () => {
    const cache = new LruCache<number, number>(10000, () => {});
    for (let i = 0; i < 10000; i++) {
      cache.set(i, i);
    }
    expect(cache.size).toBe(10000);
    // No eviction should have occurred
    for (let i = 0; i < 10000; i++) {
      expect(cache.get(i)).toBe(i);
    }
  });

  // ── LRU ordering ─────────────────────────────────────────────────────

  it('get() protects entries from eviction in LRU order', () => {
    const evicted: string[] = [];
    const cache = new LruCache<string, number>(3, (k) => evicted.push(k));

    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    // Access 'a' and 'b' to make them recently used
    cache.get('a');
    cache.get('b');

    // Now 'c' is the least recently used
    cache.set('d', 4); // evicts 'c'
    expect(evicted).toEqual(['c']);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBeUndefined();
    expect(cache.get('d')).toBe(4);
  });

  it('set() on existing key updates value without eviction', () => {
    const evicted: string[] = [];
    const cache = new LruCache<string, number>(2, (k) => evicted.push(k));

    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 10); // update, not new entry

    expect(evicted).toEqual([]);
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBe(10);
  });

  it('get() returns undefined for non-existent keys without side effects', () => {
    const cache = new LruCache<string, number>(2, () => {});
    cache.set('a', 1);

    expect(cache.get('z')).toBeUndefined();
    expect(cache.size).toBe(1); // unchanged
  });

  // ── Eviction callback ────────────────────────────────────────────────

  it('calls onEvict with both key and value for each eviction', () => {
    const evictions: Array<[string, number]> = [];
    const cache = new LruCache<string, number>(2, (k, v) => evictions.push([k, v]));

    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // evicts 'a'
    cache.set('d', 4); // evicts 'b'

    expect(evictions).toEqual([['a', 1], ['b', 2]]);
  });

  it('does not call onEvict on clear()', () => {
    const onEvict = vi.fn();
    const cache = new LruCache<string, number>(5, onEvict);

    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();

    expect(onEvict).not.toHaveBeenCalled();
  });

  it('does not call onEvict on set() for existing key', () => {
    const onEvict = vi.fn();
    const cache = new LruCache<string, number>(2, onEvict);

    cache.set('a', 1);
    cache.set('a', 10); // update
    cache.set('a', 100); // update again

    expect(onEvict).not.toHaveBeenCalled();
  });

  // ── clear() ──────────────────────────────────────────────────────────

  it('clear() resets size to 0', () => {
    const cache = new LruCache<number, string>(10, () => {});
    for (let i = 0; i < 10; i++) cache.set(i, `v${i}`);
    expect(cache.size).toBe(10);

    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('clear() allows re-use after clearing', () => {
    const cache = new LruCache<string, number>(2, () => {});
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();

    cache.set('c', 3);
    cache.set('d', 4);
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBe(4);
    expect(cache.get('a')).toBeUndefined();
  });

  // ── values() iterator ────────────────────────────────────────────────

  it('values() returns empty iterator for empty cache', () => {
    const cache = new LruCache<string, number>(5, () => {});
    expect(Array.from(cache.values())).toEqual([]);
  });

  it('values() returns items in insertion order (MRU at end)', () => {
    const cache = new LruCache<number, string>(5, () => {});
    cache.set(1, 'a');
    cache.set(2, 'b');
    cache.set(3, 'c');
    expect(Array.from(cache.values())).toEqual(['a', 'b', 'c']);
  });

  it('values() reflects get() reordering', () => {
    const cache = new LruCache<number, string>(5, () => {});
    cache.set(1, 'a');
    cache.set(2, 'b');
    cache.set(3, 'c');
    cache.get(1); // move 1 to MRU position
    expect(Array.from(cache.values())).toEqual(['b', 'c', 'a']);
  });

  // ── Stress test ──────────────────────────────────────────────────────

  it('handles rapid set/get cycles without corruption', () => {
    const cache = new LruCache<number, number>(50, () => {});
    for (let cycle = 0; cycle < 100; cycle++) {
      for (let i = 0; i < 100; i++) {
        cache.set(i, cycle * 100 + i);
        cache.get(i % 50);
      }
    }
    expect(cache.size).toBeLessThanOrEqual(50);
  });

  it('handles alternating set and evict pattern', () => {
    const evicted: number[] = [];
    const cache = new LruCache<number, string>(3, (k) => evicted.push(k));

    for (let i = 0; i < 100; i++) {
      cache.set(i, `v${i}`);
    }

    // Only last 3 entries should remain
    expect(cache.size).toBe(3);
    expect(cache.get(97)).toBe('v97');
    expect(cache.get(98)).toBe('v98');
    expect(cache.get(99)).toBe('v99');
    expect(cache.get(96)).toBeUndefined();
  });
});
