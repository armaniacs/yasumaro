/**
 * persistentRetryQueue.ts
 * Deep queue module that owns retry semantics (TTL, retry count, per-cycle cap)
 * while delegating persistence to a storage adapter.
 *
 * Replaces StorageBackedQueue (PBI-09) and absorbs the retry logic previously
 * scattered across pendingChromeStorageQueue, pendingSqliteQueue, and
 * offlineNetworkQueue.
 */

import { addLog, LogType } from '../utils/logger.js';
import { errorMessage } from '../utils/errorUtils.js';
import { QueueStorageAdapter } from './queueStorageAdapter.js';
export { ChromeStorageAdapter } from './queueStorageAdapter.js';

/**
 * Options for PersistentRetryQueue.
 */
export interface PersistentRetryQueueOptions<T> {
  /** Storage key for the queue data. */
  storageKey: string;
  /** Maximum number of items in the queue. */
  maxSize: number;
  /** Label for log messages. */
  logLabel: string;
  /** Time-to-live in milliseconds. Items older than this are dropped on flush. */
  ttlMs?: number;
  /** Maximum number of retries before an item is dropped. */
  maxRetryCount?: number;
  /** Maximum number of items to process in a single flush cycle. */
  maxJobsPerCycle?: number;
  /** Maximum payload size in bytes. Items exceeding this are dropped on enqueue. */
  maxPayloadBytes?: number;
}

/**
 * Retry metadata interface. Items that want retry semantics should implement
 * this interface. Items without these fields get simple enqueue/flush behavior.
 */
export interface RetryableItem {
  createdAt: number;
  retryCount: number;
  lastError?: string;
}

/**
 * Deep queue module: owns retry semantics, delegates persistence to adapter.
 */
export class PersistentRetryQueue<T> {
  constructor(
    private readonly adapter: QueueStorageAdapter,
    private readonly options: PersistentRetryQueueOptions<T>
  ) {}

  /**
   * Enqueue an item. Best-effort: a failure is logged but not thrown.
   */
  async enqueue(item: T): Promise<void> {
    try {
      // Payload size check (for retryable items with payload)
      if (this.options.maxPayloadBytes && isRetryable(item)) {
        const payload = (item as RetryableItem & { payload?: unknown }).payload;
        if (payload !== undefined) {
          const size = estimatePayloadSize(payload);
          if (size > this.options.maxPayloadBytes) {
            addLog(LogType.WARN, `${this.options.logLabel}: payload too large, dropping job`, {
              size,
              max: this.options.maxPayloadBytes,
            });
            return;
          }
        }
      }

      const queue = await this.adapter.load<T>(this.options.storageKey);
      queue.push(item);

      // Hard cap: drop oldest items first
      if (queue.length > this.options.maxSize) {
        const dropped = queue.splice(0, queue.length - this.options.maxSize);
        addLog(LogType.WARN, `${this.options.logLabel}: queue full, dropped oldest items`, {
          dropped: dropped.length,
        });
      }

      await this.adapter.save(this.options.storageKey, queue);
    } catch (error) {
      addLog(LogType.ERROR, `${this.options.logLabel}: failed to enqueue`, {
        error: errorMessage(error),
      });
    }
  }

  /**
   * Flush queued items via handler. Items for which handler returns false or
   * throws are kept in the queue (with retry count incremented if applicable).
   *
   * Returns remaining items. Saves remaining items back to storage.
   */
  async flush(handler: (item: T) => Promise<boolean>): Promise<T[]> {
    const items = await this.adapter.load<T>(this.options.storageKey);
    if (items.length === 0) return [];

    const now = Date.now();
    const maxJobs = this.options.maxJobsPerCycle ?? items.length;
    const toProcess = items.slice(0, maxJobs);
    const remaining: T[] = [];

    for (const item of toProcess) {
      // TTL check
      if (isRetryable(item) && this.options.ttlMs) {
        if (now - item.createdAt > this.options.ttlMs) {
          addLog(LogType.INFO, `${this.options.logLabel}: dropped expired item`, {
            id: (item as RetryableItem & { id?: string }).id,
          });
          continue;
        }
      }

      try {
        const ok = await handler(item);
        if (!ok) {
          incrementRetryCount(item);
          if (shouldDrop(item, this.options.maxRetryCount)) {
            addLog(LogType.WARN, `${this.options.logLabel}: item exceeded max retries, dropping`, {
              id: (item as RetryableItem & { id?: string }).id,
            });
            continue;
          }
          remaining.push(item);
        }
      } catch (error) {
        incrementRetryCount(item);
        setLastError(item, error);
        if (shouldDrop(item, this.options.maxRetryCount)) {
          addLog(LogType.WARN, `${this.options.logLabel}: item exceeded max retries, dropping`, {
            id: (item as RetryableItem & { id?: string }).id,
          });
          continue;
        }
        remaining.push(item);
      }
    }

    // Add untouched items (beyond maxJobsPerCycle) back to remaining
    const untouched = items.slice(maxJobs);
    const finalRemaining = [...remaining, ...untouched];

    await this.adapter.save(this.options.storageKey, finalRemaining);
    return finalRemaining;
  }

  /**
   * Load all items from storage.
   */
  async load(): Promise<T[]> {
    return this.adapter.load<T>(this.options.storageKey);
  }

  /**
   * Save items to storage.
   */
  async save(items: T[]): Promise<void> {
    await this.adapter.save(this.options.storageKey, items);
  }

  /**
   * Get current queue size.
   */
  async getQueueSize(): Promise<number> {
    const items = await this.adapter.load<T>(this.options.storageKey);
    return items.length;
  }
}

/**
 * Type guard for retryable items.
 */
function isRetryable(item: unknown): item is RetryableItem {
  return (
    typeof item === 'object' &&
    item !== null &&
    'createdAt' in item &&
    'retryCount' in item
  );
}

/**
 * Increment retry count on a retryable item.
 */
function incrementRetryCount(item: unknown): void {
  if (isRetryable(item)) {
    item.retryCount++;
  }
}

/**
 * Set last error on a retryable item.
 */
function setLastError(item: unknown, error: unknown): void {
  if (isRetryable(item)) {
    item.lastError = errorMessage(error);
  }
}

/**
 * Check if item should be dropped based on max retry count.
 */
function shouldDrop(item: unknown, maxRetryCount?: number): boolean {
  if (!maxRetryCount || !isRetryable(item)) return false;
  return item.retryCount >= maxRetryCount;
}

/**
 * Estimate payload size in bytes.
 */
function estimatePayloadSize(payload: unknown): number {
  try {
    return new Blob([JSON.stringify(payload)]).size;
  } catch {
    return 0;
  }
}
