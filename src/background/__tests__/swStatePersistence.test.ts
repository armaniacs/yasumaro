import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CACHE_INITIALIZED_KEY } from '../../background/swStatePersistence.js';
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
            flag.set(true);

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

        it('restore-once: later restores are no-ops until reset (PBI 2026-09-12-33)', async () => {
            await saveCacheInitializedState(true);
            const flag = createCacheInitializedFlag();
            await flag.restore();
            expect(flag.value).toBe(true);

            const getSession = (globalThis as unknown as { chrome: { storage: { session: { get: ReturnType<typeof vi.fn> } } } }).chrome.storage.session.get;
            const callsAfterFirst = getSession.mock.calls.length;

            // Session still holds true; even if it changed, restore-once skips the re-read
            await flag.restore();
            await flag.restore();
            expect(getSession.mock.calls.length).toBe(callsAfterFirst);
            expect(flag.value).toBe(true);

            // Prune-triggering events re-arm the restore
            flag.resetRestoreOnce();
            sessionStorage[CACHE_INITIALIZED_KEY] = false;
            await flag.restore();
            expect(flag.value).toBe(false);
        });

        it('restore performs no echo write-back of the loaded value (Proxy removed)', async () => {
            await saveCacheInitializedState(true);
            const setSession = (globalThis as unknown as { chrome: { storage: { session: { set: ReturnType<typeof vi.fn> } } } }).chrome.storage.session.set;
            setSession.mockClear();
            const flag = createCacheInitializedFlag();
            await flag.restore();
            expect(flag.value).toBe(true);
            // The loaded value must not be written back (echo removal)
            expect(setSession).not.toHaveBeenCalled();
        });

        it('handles storage get failure gracefully on load', async () => {
            vi.stubGlobal('chrome', {
                storage: {
                    session: {
                        get: vi.fn(async () => { throw new Error('fail'); }),
                        set: vi.fn(async () => {}),
                    },
                },
            });
            const value = await loadCacheInitializedState();
            expect(value).toBe(false);
        });

        it('handles storage set failure gracefully on save', async () => {
            vi.stubGlobal('chrome', {
                storage: {
                    session: {
                        get: vi.fn(async () => ({})),
                        set: vi.fn(async () => { throw new Error('fail'); }),
                    },
                },
            });
            await expect(saveCacheInitializedState(true)).resolves.toBeUndefined();
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
