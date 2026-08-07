/**
 * storageBackedQueue.ts
 * Generic chrome.storage-backed FIFO queue with a hard cap.
 * Shared by pendingSqliteQueue.ts and pendingChromeStorageQueue.ts to avoid
 * duplicating the load/save/enqueue-with-cap skeleton (PBI-09).
 */

import { addLog, LogType } from '../utils/logger.js';

export class StorageBackedQueue<T> {
  constructor(
    private readonly storageKey: string,
    private readonly maxSize: number,
    private readonly logLabel: string,
  ) {}

  /** Load the queued items from chrome.storage.local (empty if missing/invalid). */
  async load(): Promise<T[]> {
    const result = await chrome.storage.local.get(this.storageKey);
    const stored = result[this.storageKey];
    return Array.isArray(stored) ? (stored as T[]) : [];
  }

  async save(items: T[]): Promise<void> {
    await chrome.storage.local.set({ [this.storageKey]: items });
  }

  /**
   * Best-effort enqueue with a hard cap (oldest items dropped first).
   * A storage failure is logged but not thrown, so it never masks the caller's
   * original failure.
   */
  async enqueue(item: T, logFields?: Record<string, unknown>): Promise<void> {
    try {
      const queue = await this.load();
      queue.push(item);
      if (queue.length > this.maxSize) {
        queue.splice(0, queue.length - this.maxSize);
      }
      await this.save(queue);
    } catch (error) {
      addLog(LogType.ERROR, `${this.logLabel}: failed to enqueue`, {
        error: String(error),
        ...logFields,
      });
    }
  }

  /**
   * Retry every queued item via `process`. Items for which `process` returns
   * false or throws are kept in the queue; the rest are removed. Returns the
   * still-pending items. Saves the remaining queue back to storage.
   */
  async flush(process: (item: T) => Promise<boolean>): Promise<T[]> {
    const items = await this.load();
    if (items.length === 0) return [];

    const stillPending: T[] = [];
    for (const item of items) {
      try {
        const ok = await process(item);
        if (!ok) stillPending.push(item);
      } catch {
        stillPending.push(item);
      }
    }
    await this.save(stillPending);
    return stillPending;
  }
}
