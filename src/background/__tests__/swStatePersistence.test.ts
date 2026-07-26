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

            const stored = await loadCacheInitializedState();
            expect(stored).toBe(true);
        });

        it('restores the flag value via restore()', async () => {
            await saveCacheInitializedState(true);
            const flag = createCacheInitializedFlag();
            expect(flag.value).toBe(false);

            await flag.restore();

            expect(flag.value).toBe(true);
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

            const stored = await loadAutoSavedBadgeTabs();
            expect(stored.has(42)).toBe(true);
        });

        it('persists deleted tabs', async () => {
            await saveAutoSavedBadgeTabs(new Set([1, 2, 3]));
            const tabs = createAutoSavedBadgeTabs();
            await tabs.restore();
            tabs.delete(2);

            const stored = await loadAutoSavedBadgeTabs();
            expect(stored).toEqual(new Set([1, 3]));
        });

        it('restores tab ids via restore()', async () => {
            await saveAutoSavedBadgeTabs(new Set([10, 20]));
            const tabs = createAutoSavedBadgeTabs();
            expect(tabs.has(10)).toBe(false);

            await tabs.restore();

            expect(tabs.has(10)).toBe(true);
            expect(tabs.has(20)).toBe(true);
        });
    });
});
