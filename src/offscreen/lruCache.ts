/**
 * lruCache.ts
 * Minimal LRU (least-recently-used) eviction cache.
 *
 * Relies on Map's insertion-order iteration: re-inserting a key on access
 * moves it to the end, so the first key in iteration order is always the
 * least recently used one.
 */

export class LruCache<K, V> {
    private readonly store = new Map<K, V>();

    constructor(
        private readonly maxSize: number,
        private readonly onEvict: (key: K, value: V) => void
    ) {}

    get size(): number {
        return this.store.size;
    }

    get(key: K): V | undefined {
        const value = this.store.get(key);
        if (value === undefined) return undefined;

        // Move to most-recently-used position
        this.store.delete(key);
        this.store.set(key, value);
        return value;
    }

    set(key: K, value: V): void {
        if (this.store.has(key)) {
            this.store.delete(key);
        } else if (this.store.size >= this.maxSize) {
            const oldestKey = this.store.keys().next().value as K;
            const oldestValue = this.store.get(oldestKey) as V;
            this.store.delete(oldestKey);
            this.onEvict(oldestKey, oldestValue);
        }
        this.store.set(key, value);
    }

    values(): IterableIterator<V> {
        return this.store.values();
    }

    clear(): void {
        this.store.clear();
    }
}
