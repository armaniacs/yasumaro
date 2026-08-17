/**
 * queueStorageAdapter.ts
 * Storage adapter interface and chrome.storage.local implementation for
 * PersistentRetryQueue. Decouples queue semantics from the persistence backend.
 */

/**
 * Storage adapter interface for queue persistence.
 */
export interface QueueStorageAdapter {
  load<T>(key: string): Promise<T[]>;
  save<T>(key: string, items: T[]): Promise<void>;
}

/**
 * Chrome storage.local adapter.
 * Best-effort: load failures return empty array, save failures are logged
 * but not thrown, so they never mask the caller's original failure.
 */
export class ChromeStorageAdapter implements QueueStorageAdapter {
  async load<T>(key: string): Promise<T[]> {
    try {
      const result = await chrome.storage.local.get(key);
      const stored = result[key];
      return Array.isArray(stored) ? (stored as T[]) : [];
    } catch (error) {
      console.error(`[queue] failed to load ${key}:`, error);
      return [];
    }
  }

  async save<T>(key: string, items: T[]): Promise<void> {
    try {
      await chrome.storage.local.set({ [key]: items });
    } catch (error) {
      console.error(`[queue] failed to save ${key}:`, error);
    }
  }
}

/**
 * In-memory adapter for tests. Avoids touching chrome.storage entirely so
 * queue tests don't depend on a global chrome mock.
 */
export class InMemoryAdapter implements QueueStorageAdapter {
  private store = new Map<string, unknown[]>();

  async load<T>(key: string): Promise<T[]> {
    return (this.store.get(key) as T[] | undefined) ?? [];
  }

  async save<T>(key: string, items: T[]): Promise<void> {
    this.store.set(key, items);
  }
}
