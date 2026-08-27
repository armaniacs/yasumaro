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
import { estimatePayloadSize } from './queue/payload.js';
export { ChromeStorageAdapter, InMemoryAdapter } from './queueStorageAdapter.js';

/**
 * Options for PersistentRetryQueue.
 */
export interface PersistentRetryQueueOptions {
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
  /**
   * When true, flush() saves remaining items after every processed item
   * instead of once at the end. This prevents Service Worker termination
   * from losing retry-count progress for already-handled items.
   */
  persistPerItem?: boolean;
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
    private readonly options: PersistentRetryQueueOptions
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

    const maxJobs = this.options.maxJobsPerCycle ?? items.length;
    const toProcess = items.slice(0, maxJobs);
    const untouched = items.slice(maxJobs);
    const remaining: T[] = [];

    const persistState = async () => {
      await this.adapter.save(this.options.storageKey, [...remaining, ...untouched]);
    };

    const { kept, dropped } = this.filterExpiredAndOverRetry(toProcess);
    for (const item of dropped) {
      addLog(LogType.WARN, `${this.options.logLabel}: item exceeded max retries or TTL, dropping`, {
        id: (item as RetryableItem & { id?: string }).id,
      });
    }
    if (dropped.length > 0 && this.options.persistPerItem) await persistState();

    for (const item of kept) {
      try {
        const ok = await handler(item);
        if (!ok) {
          incrementRetryCount(item);
          if (shouldDrop(item, this.options.maxRetryCount)) {
            addLog(LogType.WARN, `${this.options.logLabel}: item exceeded max retries, dropping`, {
              id: (item as RetryableItem & { id?: string }).id,
            });
            if (this.options.persistPerItem) await persistState();
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
          if (this.options.persistPerItem) await persistState();
          continue;
        }
        remaining.push(item);
      }
      if (this.options.persistPerItem) await persistState();
    }

    // Final save (covers both persistPerItem and non-persistPerItem cases)
    await this.adapter.save(this.options.storageKey, [...remaining, ...untouched]);
    return [...remaining, ...untouched];
  }

  /**
   * Flush items in batches. Each batch is passed to the handler as an array.
   * The handler returns per-item booleans indicating success/failure.
   * Failed items are retained with retry count incremented.
   *
   * Always persists per-item for Service Worker resilience.
   */
  async flushBatch(
    handler: (items: T[]) => Promise<boolean[]>,
    batchSize: number
  ): Promise<T[]> {
    const items = await this.adapter.load<T>(this.options.storageKey);
    if (items.length === 0) return [];

    const maxJobs = this.options.maxJobsPerCycle ?? items.length;
    const toProcess = items.slice(0, maxJobs);
    const untouched = items.slice(maxJobs);
    const remaining: T[] = [];

    const persistState = async () => {
      await this.adapter.save(this.options.storageKey, [...remaining, ...untouched]);
    };

    const chunks = chunkArray(toProcess, batchSize);

    for (const chunk of chunks) {
      // Filter expired or max-retry-exceeded items from this chunk
      const { kept: validItems, dropped } = this.filterExpiredAndOverRetry(chunk);
      for (const item of dropped) {
        addLog(LogType.WARN, `${this.options.logLabel}: item exceeded max retries or TTL, dropping`, {
          id: (item as RetryableItem & { id?: string }).id,
        });
      }

      if (validItems.length === 0) {
        await persistState();
        continue;
      }

      try {
        const results = await handler(validItems);
        for (let i = 0; i < validItems.length; i++) {
          if (!results[i]) {
            incrementRetryCount(validItems[i]);
            if (shouldDrop(validItems[i], this.options.maxRetryCount)) {
              addLog(LogType.WARN, `${this.options.logLabel}: item exceeded max retries, dropping`, {
                id: (validItems[i] as RetryableItem & { id?: string }).id,
              });
              continue;
            }
            remaining.push(validItems[i]!);
          }
        }
      } catch (error) {
        // On batch failure, all items in the batch are retained
        for (const item of validItems) {
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
      await persistState();
    }

    // Final save
    await this.adapter.save(this.options.storageKey, [...remaining, ...untouched]);
    return [...remaining, ...untouched];
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

  /**
   * Split items into those still eligible for processing and those that
   * must be dropped (expired past ttlMs, or already at/over maxRetryCount).
   * The single source of truth for this policy — flush/flushBatch call it
   * internally, and callers needing the same filter outside a flush cycle
   * (e.g. a queue facade's peek/dequeue) should call it too instead of
   * re-deriving expiry themselves.
   */
  filterExpiredAndOverRetry(items: T[]): { kept: T[]; dropped: T[] } {
    const now = Date.now();
    const kept: T[] = [];
    const dropped: T[] = [];
    for (const item of items) {
      if (shouldDrop(item, this.options.maxRetryCount)) {
        dropped.push(item);
        continue;
      }
      if (isRetryable(item) && this.options.ttlMs && now - item.createdAt > this.options.ttlMs) {
        dropped.push(item);
        continue;
      }
      kept.push(item);
    }
    return { kept, dropped };
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
 * Split an array into chunks of at most `size` items.
 * Exported for unit testing and use by flushBatch.
 */
export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
