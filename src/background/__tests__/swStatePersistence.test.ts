import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    loadCacheInitializedState,
    saveCacheInitializedState,
    createCacheInitializedFlag,
    loadAutoSavedBadgeTabs,
    saveAutoSavedBadgeTabs,
    createAutoSavedBadgeTabs,
} from '../swStatePersistence.js';

describe('swStatePersistence', () => {
    let sessionStorage: Record<string, unknown>;

    beforeEach(() => {
        sessionStorage = {};
        vi.stubGlobal('chrome', {
            storage: {
                session: {
                    get: vi.fn(async (key: string | string[]) => {
                        const keys = Array.isArray(key) ? key : [key];
                        const result: Record<string, unknown> = {};
                        keys.forEach((k) => {
                            if (k in sessionStorage) result[k] = sessionStorage[k];
                        });
                        return result;
                    }),
                    set: vi.fn(async (items: Record<string, unknown>) => {
                        Object.assign(sessionStorage, items);
                    }),
                },
            },
        });
    });

    describe('cache initialized flag', () => {
        it('loads false when no value is stored', async () => {
            const value = await loadCacheInitializedState();
            expect(value).toBe(false);
        });

        it('saves and loads the flag value', async () => {
            await saveCacheInitializedState(true);
            const value = await loadCacheInitializedState();
            expect(value).toBe(true);
        });

        it('persists the flag when set via createCacheInitializedFlag', async () => {
            const flag = createCacheInitializedFlag();
            flag.value = true;

            await new Promise((resolve) => setTimeout(resolve, 10));

            const stored = await loadCacheInitializedState();
            expect(stored).toBe(true);
        });
    });

    describe('auto-saved badge tabs', () => {
        it('loads an empty set when no value is stored', async () => {
            const tabs = await loadAutoSavedBadgeTabs();
            expect(tabs.size).toBe(0);
        });

        it('saves and loads tab ids', async () => {
            await saveAutoSavedBadgeTabs(new Set([1, 2, 3]));
            const tabs = await loadAutoSavedBadgeTabs();
            expect(tabs).toEqual(new Set([1, 2, 3]));
        });

        it('persists added tabs', async () => {
            const tabs = createAutoSavedBadgeTabs();
            tabs.add(42);

            await new Promise((resolve) => setTimeout(resolve, 10));

            const stored = await loadAutoSavedBadgeTabs();
            expect(stored.has(42)).toBe(true);
        });

        it('persists deleted tabs', async () => {
            await saveAutoSavedBadgeTabs(new Set([1, 2, 3]));
            const tabs = createAutoSavedBadgeTabs();

            await new Promise((resolve) => setTimeout(resolve, 10));

            tabs.delete(2);
            await new Promise((resolve) => setTimeout(resolve, 10));

            const stored = await loadAutoSavedBadgeTabs();
            expect(stored).toEqual(new Set([1, 3]));
        });
    });
});
