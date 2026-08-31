import { Mutex } from '../../utils/Mutex.js';

/**
 * Per-URL mutex map.
 * Serializes concurrent recordings of the same URL to protect the
 * read-then-write window between checkDuplicateStep and saveMetadataStep.
 *
 * Instance-based via DI container; tests can inject an isolated map
 * via container.override('perUrlMutexMap', new PerUrlMutexMap(new Map())).
 */
export class PerUrlMutexMap {
  private static readonly MUTEX_OPTS = { maxQueueSize: 5, timeoutMs: 60000 } as const;
  private static createMutex(): Mutex { return new Mutex(PerUrlMutexMap.MUTEX_OPTS); }

  private readonly mutexes: Map<string, Mutex>;

  constructor(map?: Map<string, Mutex>) {
    this.mutexes = map ?? new Map();
  }

  async runExclusive<T>(url: string, fn: () => Promise<T>): Promise<T> {
    const mutex = this.getOrCreate(url);
    return PerUrlMutexMap.runExclusiveOn(mutex, url, this.mutexes, fn);
  }

  private getOrCreate(url: string): Mutex {
    let mutex = this.mutexes.get(url);
    if (!mutex) {
      mutex = PerUrlMutexMap.createMutex();
      this.mutexes.set(url, mutex);
    }
    return mutex;
  }

  /**
   * Single acquire/release/cleanup path.
   * The cleanup drops the map entry only when the mutex is fully idle
   * (no current lock and no queued waiters), so a URL with a pending
   * concurrent recording keeps its entry.
   */
  private static async runExclusiveOn<T>(
    mutex: Mutex,
    url: string,
    map: Map<string, Mutex>,
    fn: () => Promise<T>,
  ): Promise<T> {
    let acquired = false;
    try {
      await mutex.acquire();
      acquired = true;
      return await fn();
    } finally {
      // Only release when acquire() succeeded. On queue-full or timeout the
      // mutex is still held by another recording; releasing here would
      // transfer/unlock the real holder's lock and break per-URL serialization.
      if (acquired) {
        mutex.release();
      }
      // Cleanup even when acquire() threw (queue-full / timeout): if the
      // mutex is fully idle (no lock, no waiters) the map entry is stale
      // and must be removed to avoid a permanent leak. Guard keeps
      // busy mutexes (locked or queued) alive for correct serialization.
      if (!mutex.isLocked() && mutex.getQueueSize() === 0) {
        map.delete(url);
      }
    }
  }
}
