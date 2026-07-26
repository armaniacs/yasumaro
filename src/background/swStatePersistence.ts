/**
 * swStatePersistence.ts
 * Persists short-lived Service Worker module state to chrome.storage.session
 * so it survives SW restarts. Extracted from service-worker.ts as part of
 * PBI-35 (state persistence) and the broader service-worker refactor.
 */

const CACHE_INITIALIZED_KEY = 'serviceWorkerCacheInitialized';
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

export interface CacheInitializedFlag {
    value: boolean;
}

/**
 * Creates a mutable flag backed by chrome.storage.session.
 * The current value is updated asynchronously after creation; callers should
 * treat the initial `false` as a conservative default.
 */
export function createCacheInitializedFlag(): CacheInitializedFlag {
    const flag: CacheInitializedFlag = { value: false };

    loadCacheInitializedState()
        .then((stored) => {
            flag.value = stored;
        })
        .catch(() => {
            // Best-effort restore; keep the conservative default.
        });

    return new Proxy(flag, {
        set(target, property, newValue: boolean) {
            target.value = newValue;
            void saveCacheInitializedState(newValue);
            return true;
        },
    });
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
}

/**
 * Creates an in-memory Set of tab IDs that is asynchronously rehydrated from
 * chrome.storage.session and persisted on every mutation.
 */
export function createAutoSavedBadgeTabs(): AutoSavedBadgeTabs {
    const tabs = new Set<number>();

    loadAutoSavedBadgeTabs()
        .then((stored) => {
            stored.forEach((tabId) => tabs.add(tabId));
        })
        .catch(() => {
            // Best-effort restore; keep the empty set default.
        });

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
    };
}
