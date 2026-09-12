/**
 * swStatePersistence.ts
 * Persists short-lived Service Worker module state to chrome.storage.session
 * so it survives SW restarts. Extracted from service-worker.ts as part of
 * PBI-35 (state persistence) and the broader service-worker refactor.
 */

/** Session keys exported for tests and cross-module diagnostics (PBI
 * 2026-09-12-33: the key was module-private and a test assigning through the
 * un-exported name wrote the literal key "undefined"). */
export const CACHE_INITIALIZED_KEY = 'serviceWorkerCacheInitialized';
const AUTO_SAVED_BADGE_TABS_KEY = 'serviceWorkerAutoSavedBadgeTabs';

export async function loadCacheInitializedState(): Promise<boolean> {
    try {
        const stored = await chrome.storage.session.get(CACHE_INITIALIZED_KEY) as Record<string, boolean | undefined>;
        return stored[CACHE_INITIALIZED_KEY] ?? false;
    } catch {
        return false;
    }
}

export async function saveCacheInitializedState(value: boolean): Promise<void> {
    try {
        await chrome.storage.session.set({ [CACHE_INITIALIZED_KEY]: value });
    } catch {
        // Best-effort; in-memory flag still protects this SW lifetime.
    }
}

/** Restore-once seam (PBI 2026-09-12-25): the first `restore()` runs, later
 * calls are no-ops until `resetRestoreOnce()` (prune-triggering events). */
export interface RestoreOnce {
    restoredOnce(): boolean;
    resetRestoreOnce(): void;
}

export interface CacheInitializedFlag extends RestoreOnce {
    /** Current flag value. Mutate via `set()` — the constructor's Proxy echo
     * trap was removed in PBI 2026-09-12-33 (restore wrote back the value it
     * had just loaded, doubling session traffic on the hottest path). */
    readonly value: boolean;
    set(value: boolean): void;
    restore(): Promise<void>;
}

/**
 * Creates a flag backed by chrome.storage.session.
 * Callers must await `restore()` before relying on the value across a
 * Service Worker restart. Restore-once (PBI 2026-09-12-33): the first
 * `restore()` performs the session read; later calls are no-ops until
 * `resetRestoreOnce()`.
 */
export function createCacheInitializedFlag(): CacheInitializedFlag {
    let value = false;
    let restoredOnce = false;

    return {
        get value() { return value; },
        restoredOnce: () => restoredOnce,
        resetRestoreOnce: () => { restoredOnce = false; },
        set(newValue: boolean) {
            value = newValue;
            void saveCacheInitializedState(newValue);
        },
        async restore() {
            if (restoredOnce) return;
            restoredOnce = true;
            value = await loadCacheInitializedState();
        },
    };
}

export async function loadAutoSavedBadgeTabs(): Promise<Set<number>> {
    try {
        const stored = await chrome.storage.session.get(AUTO_SAVED_BADGE_TABS_KEY) as Record<string, number[] | undefined>;
        return new Set(stored[AUTO_SAVED_BADGE_TABS_KEY] ?? []);
    } catch {
        return new Set();
    }
}

export async function saveAutoSavedBadgeTabs(tabs: Set<number>): Promise<void> {
    try {
        await chrome.storage.session.set({ [AUTO_SAVED_BADGE_TABS_KEY]: Array.from(tabs) });
    } catch {
        // Best-effort; in-memory set still protects this SW lifetime.
    }
}

export interface AutoSavedBadgeTabs {
    has(tabId: number): boolean;
    add(tabId: number): void;
    delete(tabId: number): void;
    restore(): Promise<void>;
}

/**
 * Creates an in-memory Set of tab IDs that is persisted on every mutation.
 * Callers must await `restore()` before relying on the set across a Service
 * Worker restart.
 *
 * PBI 2026-09-12-24: `restore` is now add-AND-prune — an optional
 * `tabExistence` port lets the caller drop tab IDs that no longer exist
 * (closed while the SW was down). Without pruning the set grew without
 * bound and `resolveTabBadge({isRecorded})` could stamp a stale recorded
 * badge onto a recycled tab ID.
 */
export function createAutoSavedBadgeTabs(tabExistence?: {
    exists(tabId: number): Promise<boolean>;
}): AutoSavedBadgeTabs & RestoreOnce {
    const tabs = new Set<number>();
    let restoredOnce = false;

    return {
        has: (tabId: number) => tabs.has(tabId),
        add: (tabId: number) => {
            tabs.add(tabId);
            void saveAutoSavedBadgeTabs(tabs);
        },
        delete: (tabId: number) => {
            tabs.delete(tabId);
            void saveAutoSavedBadgeTabs(tabs);
        },
        // PBI 2026-09-12-25: restore-once — the fan-out (tabs.get × N + set)
        // runs on the first call only; the message handler no longer pays it
        // per message. `resetRestoreOnce()` re-arms it for prune-triggering
        // events (handleTabRemoved).
        restoredOnce: () => restoredOnce,
        resetRestoreOnce: () => { restoredOnce = false; },
        restore: async () => {
            if (restoredOnce) return;
            restoredOnce = true;
            const stored = await loadAutoSavedBadgeTabs();
            if (tabExistence) {
                const checks = await Promise.all(
                    Array.from(stored).map(async (tabId) => ({ tabId, alive: await tabExistence.exists(tabId) })),
                );
                for (const { tabId, alive } of checks) {
                    if (alive) tabs.add(tabId);
                    else tabs.delete(tabId);
                }
            } else {
                stored.forEach((tabId) => tabs.add(tabId));
            }
            void saveAutoSavedBadgeTabs(tabs);
        },
    };
}
