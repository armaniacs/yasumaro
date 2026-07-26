/**
 * tabCacheFactory.ts
 * Lazy-initialization wrapper for TabCache, extracted from service-worker.ts
 * as a test case for the singleton-to-lazy-init migration (PBI-36). Once
 * this pattern proves out, the remaining clients (ObsidianClient, AIClient,
 * LocalAIClient, RecordingLogic, SqliteClient) can follow the same shape in
 * a follow-up PBI.
 */
import { TabCache } from './tabCache.js';
import { SessionStore } from './sessionStore.js';

let instance: TabCache | null = null;

export function getTabCacheInstance(sessionStore: SessionStore): TabCache {
    if (!instance) {
        instance = new TabCache(sessionStore);
    }
    return instance;
}

/** Test-only: resets the singleton so each test starts with a fresh instance. */
export function resetTabCacheInstanceForTesting(): void {
    instance = null;
}
