/**
 * lruCache.test.ts
 * Tests for the LRU eviction cache used by the prepared statement cache (M33)
 */

import { describe, it, expect, vi } from 'vitest';
import { LruCache } from '../lruCache.js';

describe('LruCache', () => {
    it('evicts the least recently used entry when capacity is exceeded', () => {
        const evicted: string[] = [];
        const cache = new LruCache<string, number>(2, (key) => evicted.push(key));

        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3); // capacity 2 -> evict 'a' (least recently used)

        expect(evicted).toEqual(['a']);
        expect(cache.get('a')).toBeUndefined();
        expect(cache.get('b')).toBe(2);
        expect(cache.get('c')).toBe(3);
    });

    it('marks an entry as recently used on get, protecting it from eviction', () => {
        const evicted: string[] = [];
        const cache = new LruCache<string, number>(2, (key) => evicted.push(key));

        cache.set('a', 1);
        cache.set('b', 2);
        cache.get('a'); // 'a' becomes most recently used
        cache.set('c', 3); // capacity 2 -> evict 'b', not 'a'

        expect(evicted).toEqual(['b']);
        expect(cache.get('a')).toBe(1);
        expect(cache.get('c')).toBe(3);
    });

    it('does not evict when re-setting an existing key', () => {
        const evicted: string[] = [];
        const cache = new LruCache<string, number>(2, (key) => evicted.push(key));

        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('a', 10); // update existing key, size stays at 2

        expect(evicted).toEqual([]);
        expect(cache.get('a')).toBe(10);
        expect(cache.size).toBe(2);
    });

    it('calls the eviction callback with the evicted value', () => {
        const onEvict = vi.fn();
        const cache = new LruCache<string, number>(1, onEvict);

        cache.set('a', 1);
        cache.set('b', 2);

        expect(onEvict).toHaveBeenCalledWith('a', 1);
    });

    it('clear() empties the cache without calling onEvict', () => {
        const onEvict = vi.fn();
        const cache = new LruCache<string, number>(2, onEvict);

        cache.set('a', 1);
        cache.clear();

        expect(cache.size).toBe(0);
        expect(cache.get('a')).toBeUndefined();
        expect(onEvict).not.toHaveBeenCalled();
    });

    it('values() iterates all cached values', () => {
        const cache = new LruCache<string, number>(3, () => {});
        cache.set('a', 1);
        cache.set('b', 2);

        expect(Array.from(cache.values())).toEqual([1, 2]);
    });
});
