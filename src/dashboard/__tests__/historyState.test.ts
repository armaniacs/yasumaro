// @vitest-environment jsdom
/**
 * historyState.test.ts
 * Unit tests for historyState.ts
 */
import { describe, it, expect } from 'vitest';

import {
    createInitialState,
    getCachedMessage,
    HISTORY_PAGE_SIZE,
} from '../historyState.js';

describe('createInitialState', () => {
    it('creates state with empty entries', () => {
        const state = createInitialState();
        expect(state.entries).toEqual([]);
    });

    it('creates state with default filter all', () => {
        const state = createInitialState();
        expect(state.activeFilter).toBe('all');
    });

    it('creates state with null activeTagFilter', () => {
        const state = createInitialState();
        expect(state.activeTagFilter).toBeNull();
    });

    it('creates state with page 0', () => {
        const state = createInitialState();
        expect(state.historyCurrentPage).toBe(0);
    });

    it('creates state with empty pending pages', () => {
        const state = createInitialState();
        expect(state.pendingPages).toEqual([]);
    });

    it('creates state with empty pending url set', () => {
        const state = createInitialState();
        expect(state.pendingUrlSet).toEqual(new Set());
    });

    it('creates state with null editing url', () => {
        const state = createInitialState();
        expect(state.editingUrl).toBeNull();
    });

    it('creates state with empty editing tags', () => {
        const state = createInitialState();
        expect(state.editingTags).toEqual([]);
    });

    it('creates state with null tag edit trap id', () => {
        const state = createInitialState();
        expect(state.tagEditTrapId).toBeNull();
    });
});

describe('HISTORY_PAGE_SIZE', () => {
    it('is defined as 10', () => {
        expect(HISTORY_PAGE_SIZE).toBe(10);
    });
});

describe('getCachedMessage', () => {
    it('caches result on first call and returns cached on second call', () => {
        const key1 = 'uniqueKeyForCacheTest1';
        const key2 = 'uniqueKeyForCacheTest2';

        // First call for key1 - message not found so returns key1
        const result1 = getCachedMessage(key1, 'fallback');
        expect(result1).toBe(key1); // Returns key since mock returns key when no translation

        // Second call for key1 - should return cached value
        const result2 = getCachedMessage(key1, 'different fallback');
        expect(result2).toBe(key1); // Cached value

        // First call for key2 - returns key2
        const result3 = getCachedMessage(key2, 'another fallback');
        expect(result3).toBe(key2);
    });
});
