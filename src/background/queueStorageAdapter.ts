/**
 * queueStorageAdapter.ts
 * Storage adapter interface and chrome.storage.local implementation for
 * PersistentRetryQueue. Decouples queue semantics from the persistence backend.
 */

/**
 * Storage adapter interface for queue persistence.
 *
 * Both methods may REJECT on storage failure (quota exceeded, transient I/O
 * error, ...). The adapter deliberately does not swallow errors: swallowing
 * made the last-resort queue lose data silently (PBI 2026-09-17-15). Failure
 * handling (structured logging, no-masking semantics for the caller's original
 * error) is owned by PersistentRetryQueue, not by the adapter.
 */
export interface QueueStorageAdapter {
  load<T>(key: string): Promise<T[]>;
  save<T>(key: string, items: T[]): Promise<void>;
}

/**
 * Chrome storage.local adapter. Rejects on storage failure; the queue turns
 * rejections into structured logs and best-effort flow control.
 */
export class ChromeStorageAdapter implements QueueStorageAdapter {
  async load<T>(key: string): Promise<T[]> {
    const result = await chrome.storage.local.get(key);
    const stored = result[key];
    return Array.isArray(stored) ? (stored as T[]) : [];
  }

  async save<T>(key: string, items: T[]): Promise<void> {
    await chrome.storage.local.set({ [key]: items });
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
