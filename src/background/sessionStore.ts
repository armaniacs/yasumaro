import { addLog, LogType } from '../utils/logger.js';

export const SESSION_KEYS = {
  SKIP_AI_RATE_LIMITER: 'sw:rateLimiter',
  TAB_CACHE: 'sw:tabCache',
  RECORDING_CACHE: 'sw:recordingCache',
} as const;

export class SessionStore {
  private writeQueue = new Map<string, unknown>();
  private deleteQueue = new Set<string>();
  private flushPromise: Promise<void> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushToken = 0;
  private disposed = false;

  // フラッシュ間隔（ミリ秒）- マイクロタスクより少し遅らせるが、まだ応答性を保つ
  private readonly FLUSH_DELAY = 50;

  async get<T>(key: string): Promise<T | null> {
    try {
      if (chrome?.storage?.session) {
        const result = await chrome.storage.session.get(key);
        return (result[key] as T) ?? null;
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
    if (this.flushPromise) {
      await this.flushPromise;
      return;
    }

    let resolve!: () => void;
    this.flushPromise = new Promise<void>((r) => {
      resolve = r;
    });

    if (this.writeQueue.size === 0 && this.deleteQueue.size === 0) {
      this.flushPromise = null;
      resolve();
      return;
    }

    const items = new Map(this.writeQueue);
    const keysToDelete = new Set(this.deleteQueue);
    this.writeQueue.clear();
    this.deleteQueue.clear();

    try {
      if (chrome?.storage?.session) {
        if (items.size > 0) {
          const obj: Record<string, unknown> = {};
          for (const [key, value] of items) {
            obj[key] = value;
          }
          await chrome.storage.session.set(obj);
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
        this.flushPromise = null;
        resolve();
        return;
      }

      // フラッシュに失敗した場合はキューに戻してリトライ
      for (const [key, value] of items) {
        this.writeQueue.set(key, value);
      }
      for (const key of keysToDelete) {
        this.deleteQueue.add(key);
      }
      this.flushPromise = null;
      resolve();
      // 遅延後に再試行
      this.scheduleFlush();
      return;
    }
    this.flushPromise = null;
    resolve();
  }

  async waitForFlush(): Promise<void> {
    if (this.disposed) return;
    // タイマーがあればまずそれを待つ
    if (this.flushTimer) {
      await new Promise<void>((resolve) => {
        const checkComplete = () => {
          if (!this.flushTimer || this.flushPromise) {
            resolve();
          } else {
            setTimeout(checkComplete, 10);
          }
        };
        setTimeout(checkComplete, 10);
      });
    }
    const promise = this.flushPromise;
    if (promise) await promise;
  }

  static mapToEntries<K, V>(map: Map<K, V>): [K, V][] {
    return Array.from(map.entries());
  }

  static entriesToMap<K, V>(entries: [K, V][]): Map<K, V> {
    return new Map(entries);
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
