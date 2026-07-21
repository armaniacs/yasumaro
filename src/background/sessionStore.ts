import { addLog, LogType } from '../utils/logger.js';

export const SESSION_KEYS = {
  SKIP_AI_RATE_LIMITER: 'sw:rateLimiter',
  TAB_CACHE: 'sw:tabCache',
  RECORDING_CACHE: 'sw:recordingCache',
} as const;

// When the RECORDING_CACHE value exceeds the session quota, only these
// sub-keys are preserved so the most critical settings cache survives.
const PRIORITY_SUBKEYS = ['settingsCache', 'cacheTimestamp', 'cacheVersion'];

export class SessionStore {
  private writeQueue = new Map<string, unknown>();
  private deleteQueue = new Set<string>();
  private flushPromise: Promise<void> | null = null;
  private flushQueue: Promise<void>[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushToken = 0;
  private disposed = false;
  private localFallbackCheckedKeys = new Set<string>();

  // フラッシュ間隔（ミリ秒）- マイクロタスクより少し遅らせるが、まだ応答性を保つ
  private readonly FLUSH_DELAY = 50;

  async get<T>(key: string): Promise<T | null> {
    try {
      if (chrome?.storage?.session) {
        const result = await chrome.storage.session.get(key);
        if (key in result) {
          return result[key] as T;
        }
        // session にデータがない場合、local からのフォールバック移行を試す
        if (!this.localFallbackCheckedKeys.has(key)) {
          this.localFallbackCheckedKeys.add(key);
          const migrated = await SessionStore.migrateFromLocalStorageIfSessionEmpty(key);
          if (migrated) {
            const fallbackResult = await chrome.storage.session.get(key);
            return (fallbackResult[key] as T) ?? null;
          }
        }
      }
    } catch {
      // chrome.storage.session unavailable
    }
    return null;
  }

  set(key: string, value: unknown): void {
    if (this.disposed) return;
    this.writeQueue.set(key, value);
    this.deleteQueue.delete(key);
    this.scheduleFlush();
  }

  remove(key: string): void {
    if (this.disposed) return;
    this.writeQueue.delete(key);
    this.deleteQueue.add(key);
    this.scheduleFlush();
  }

  // 重要な操作後に即座にフラッシュしたい場合のメソッド
  async flushNow(): Promise<void> {
    if (this.disposed) return;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    // Cancel any pending timer-based flush and run immediately under a new token.
    this.flushToken++;
    await this.flush();
  }

  /**
   * Dispose the store: cancel pending timers and drop queued work.
   * Useful for test cleanup where pending timers could leak into the next test.
   */
  dispose(): void {
    this.disposed = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.writeQueue.clear();
    this.deleteQueue.clear();
    this.flushPromise = null;
    this.flushQueue.length = 0;
    this.localFallbackCheckedKeys.clear();
  }

  private scheduleFlush(): void {
    if (this.disposed) return;
    // 既にフラッシュがスケジュールまたは実行中の場合は何もしない
    if (this.flushPromise || this.flushTimer) return;

    // タイマーベースのフラッシュをスケジュール
    this.flushToken++;
    const token = this.flushToken;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      // Guard against stale timers in environments where clearTimeout may be
      // unreliable or the callback was already queued.
      if (this.disposed || this.flushToken !== token) return;
      this.flush();
    }, this.FLUSH_DELAY);
  }

  private async flush(): Promise<void> {
    if (this.disposed) return;

    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    this.flushQueue.push(promise);

    if (this.flushPromise) {
      await this.flushPromise;
      this.removeFromFlushQueue(promise);
      resolve();
      return;
    }

    this.flushPromise = promise;

    let items = new Map<string, unknown>();
    let keysToDelete = new Set<string>();
    let shouldRetry = false;

    try {
      if (this.writeQueue.size === 0 && this.deleteQueue.size === 0) {
        return;
      }

      items = new Map(this.writeQueue);
      keysToDelete = new Set(this.deleteQueue);
      this.writeQueue.clear();
      this.deleteQueue.clear();

      if (chrome?.storage?.session) {
        if (items.size > 0) {
          const obj: Record<string, unknown> = {};
          for (const [key, value] of items) {
            obj[key] = value;
          }

          const estimatedSize = this.estimateStorageSize(obj);
          if (estimatedSize > this.MAX_SESSION_SIZE) {
            addLog(LogType.WARN, 'SessionStore: estimated flush size exceeds 1MB, saving priority data only', {
              estimatedSize,
              keys: Array.from(items.keys()),
            });
            const priorityObj = this.extractPriorityData(items);
            await chrome.storage.session.set(priorityObj);
            // Restore non-priority data to the write queue so it stays in memory
            // for the current service-worker lifetime.
            for (const [key, value] of items) {
              if (!(key in priorityObj) || priorityObj[key] !== value) {
                this.writeQueue.set(key, value);
              }
            }
          } else {
            await chrome.storage.session.set(obj);
          }
        }
        if (keysToDelete.size > 0) {
          await chrome.storage.session.remove(Array.from(keysToDelete));
        }
      }
    } catch (error) {
      // chrome.storage.session unavailable or quota exceeded
      if (isQuotaError(error)) {
        // Session storage quota (~1MB) exceeded. Keep data in memory for the
        // current service-worker lifetime, but do not retry the failed flush.
        addLog(LogType.WARN, 'SessionStore: session storage quota exceeded, keeping data in memory', {
          keys: Array.from(items.keys()),
        });
        // Restore items so callers still see the latest in-memory values.
        for (const [key, value] of items) {
          this.writeQueue.set(key, value);
        }
        return;
      }

      // フラッシュに失敗した場合はキューに戻してリトライ
      for (const [key, value] of items) {
        this.writeQueue.set(key, value);
      }
      for (const key of keysToDelete) {
        this.deleteQueue.add(key);
      }
      shouldRetry = true;
      return;
    } finally {
      this.flushPromise = null;
      this.removeFromFlushQueue(promise);
      resolve();
      if (shouldRetry) {
        this.scheduleFlush();
      }
    }
  }

  private removeFromFlushQueue(promise: Promise<void>): void {
    const index = this.flushQueue.indexOf(promise);
    if (index >= 0) {
      this.flushQueue.splice(index, 1);
    }
  }

  private readonly MAX_SESSION_SIZE = 1 * 1024 * 1024;

  private estimateStorageSize(value: unknown): number {
    try {
      return new Blob([JSON.stringify(value)]).size;
    } catch {
      return 0;
    }
  }

  private extractPriorityData(items: Map<string, unknown>): Record<string, unknown> {
    const priorityObj: Record<string, unknown> = {};
    const recordingCacheKey = SESSION_KEYS.RECORDING_CACHE;

    for (const [key, value] of items) {
      if (key === recordingCacheKey && typeof value === 'object' && value !== null) {
        const reduced: Record<string, unknown> = {};
        for (const subKey of PRIORITY_SUBKEYS) {
          if (subKey in value) {
            reduced[subKey] = (value as Record<string, unknown>)[subKey];
          }
        }
        priorityObj[key] = reduced;
      } else {
        priorityObj[key] = value;
      }
    }

    return priorityObj;
  }

  async waitForFlush(): Promise<void> {
    if (this.disposed) return;
    // スケジュールされたタイマーがあれば即座にフラッシュして待つ
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
      await this.flush();
      return;
    }
    // 実行中または待機中のフラッシュがあればすべて完了するのを待つ
    if (this.flushQueue.length > 0) {
      await Promise.all([...this.flushQueue]);
    }
  }

  static mapToEntries<K, V>(map: Map<K, V>): [K, V][] {
    return Array.from(map.entries());
  }

  static entriesToMap<K, V>(entries: [K, V][]): Map<K, V> {
    return new Map(entries);
  }

  /**
   * Register a chrome.runtime.onSuspend listener that writes any unflushed
   * queued data to chrome.storage.local as an emergency backup. This is a
   * best-effort guard because the Service Worker may terminate before the
   * asynchronous local write completes.
   */
  static registerSuspendHandler(store: SessionStore): void {
    if (typeof chrome !== 'undefined' && chrome.runtime?.onSuspend) {
      chrome.runtime.onSuspend.addListener(() => {
        store.emergencyFlushToLocal();
      });
    }
  }

  /**
   * Write queued items to chrome.storage.local immediately. Used as an
   * emergency fallback when the Service Worker is about to suspend.
   */
  emergencyFlushToLocal(): void {
    if (this.writeQueue.size === 0) return;

    const items: Record<string, unknown> = {};
    for (const [key, value] of this.writeQueue) {
      items[key] = value;
    }

    if (chrome?.storage?.local) {
      // Fire-and-forget: we cannot reliably await inside onSuspend.
      chrome.storage.local.set(items).catch(() => {
        // Ignore errors: this is best-effort emergency persistence.
      });
    }
  }

  /**
   * Fallback migration for a single key: if session storage does not contain
   * the requested key but local storage does, move it to session storage.
   * This restores data after session storage is cleared (e.g., Service Worker
   * restart or browser update) without re-scanning all local storage each time.
   */
  static async migrateFromLocalStorageIfSessionEmpty(key: string): Promise<boolean> {
    if (!chrome?.storage?.local || !chrome?.storage?.session) {
      return false;
    }

    try {
      const localResult = await chrome.storage.local.get(key);
      if (!(key in localResult)) return false;

      await chrome.storage.session.set({ [key]: localResult[key] });
      await chrome.storage.local.remove(key);

      addLog(LogType.INFO, 'SessionStore: migrated single key from local to session storage', {
        key,
      });
      return true;
    } catch (error) {
      addLog(LogType.ERROR, 'SessionStore: failed to migrate single key from local storage', {
        key,
        error: String(error),
      });
      return false;
    }
  }

  /**
   * One-time migration: move session-scoped keys previously stored in
   * chrome.storage.local to chrome.storage.session, then clean up the old keys.
   * Should be called once at service-worker startup before SessionStore is used.
   */
  static async migrateFromLocalStorage(): Promise<boolean> {
    if (!chrome?.storage?.local || !chrome?.storage?.session) {
      return false;
    }

    try {
      const all = await chrome.storage.local.get(null);
      const entries = Object.entries(all).filter(([key]) => key.startsWith('sw:'));
      if (entries.length === 0) return false;

      const items: Record<string, unknown> = {};
      for (const [key, value] of entries) {
        items[key] = value;
      }

      await chrome.storage.session.set(items);
      await chrome.storage.local.remove(entries.map(([key]) => key));

      addLog(LogType.INFO, 'SessionStore: migrated session data from local to session storage', {
        keys: entries.map(([key]) => key),
      });
      return true;
    } catch (error) {
      addLog(LogType.ERROR, 'SessionStore: failed to migrate session data', {
        error: String(error),
      });
      return false;
    }
  }
}

function isQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /quota|QUOTA_BYTES/i.test(message);
}
