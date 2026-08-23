import { Mutex } from '../../utils/Mutex.js';

/**
 * Per-URL mutex map.
 * Serializes concurrent recordings of the same URL to protect the
 * read-then-write window between checkDuplicateStep and saveMetadataStep.
 *
 * Uses a shared static map so all RecordingPipeline instances serialize
 * the same URL. This preserves the original static urlRecordMutexes
 * semantics while allowing instance-based injection.
 */
export class PerUrlMutexMap {
  private static sharedMutexes = new Map<string, Mutex>();

  private get mutexes(): Map<string, Mutex> {
    return PerUrlMutexMap.sharedMutexes;
  }

  async runExclusive<T>(url: string, fn: () => Promise<T>): Promise<T> {
    const mutex = this.getOrCreate(url);
    return PerUrlMutexMap.runExclusiveOn(mutex, url, this.mutexes, fn);
  }

  private getOrCreate(url: string): Mutex {
    let mutex = this.mutexes.get(url);
    if (!mutex) {
      mutex = new Mutex({ maxQueueSize: 5, timeoutMs: 60000 });
      this.mutexes.set(url, mutex);
    }
    return mutex;
  }

  /** Exposed for RecordingPipeline static compat and tests. */
  static getSharedMap(): Map<string, Mutex> {
    return PerUrlMutexMap.sharedMutexes;
  }

  static getOrCreateStatic(url: string): Mutex {
    let mutex = PerUrlMutexMap.sharedMutexes.get(url);
    if (!mutex) {
      mutex = new Mutex({ maxQueueSize: 5, timeoutMs: 60000 });
      PerUrlMutexMap.sharedMutexes.set(url, mutex);
    }
    return mutex;
  }

  static async runExclusiveStatic<T>(url: string, fn: () => Promise<T>): Promise<T> {
    const mutex = PerUrlMutexMap.getOrCreateStatic(url);
    return PerUrlMutexMap.runExclusiveOn(mutex, url, PerUrlMutexMap.sharedMutexes, fn);
  }

  /**
   * Single acquire/release/cleanup path for both instance and static callers.
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
    try {
      await mutex.acquire();
      return await fn();
    } finally {
      mutex.release();
      if (!mutex.isLocked() && mutex.getQueueSize() === 0) {
        map.delete(url);
      }
    }
  }
}
