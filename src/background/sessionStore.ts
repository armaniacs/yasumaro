export const SESSION_KEYS = {
  SKIP_AI_RATE_LIMITER: 'sw:rateLimiter',
  TAB_CACHE: 'sw:tabCache',
  RECORDING_CACHE: 'sw:recordingCache',
} as const;

export class SessionStore {
  private writeQueue = new Map<string, unknown>();
  private deleteQueue = new Set<string>();
  private flushResolve: (() => void) | null = null;
  private flushPromise: Promise<void> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  // フラッシュ間隔（ミリ秒）- マイクロタスクより少し遅らせるが、まだ応答性を保つ
  private readonly FLUSH_DELAY = 50;

  async get<T>(key: string): Promise<T | null> {
    try {
      if (chrome?.storage?.local) {
        const result = await chrome.storage.local.get(key);
        return (result[key] as T) ?? null;
      }
    } catch {
      // chrome.storage.local unavailable
    }
    return null;
  }

  set(key: string, value: unknown): void {
    this.writeQueue.set(key, value);
    this.deleteQueue.delete(key);
    this.scheduleFlush();
  }

  remove(key: string): void {
    this.writeQueue.delete(key);
    this.deleteQueue.add(key);
    this.scheduleFlush();
  }

  // 重要な操作後に即座にフラッシュしたい場合のメソッド
  async flushNow(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  private scheduleFlush(): void {
    // 既にフラッシュがスケジュールされている場合は何もしない
    if (this.flushPromise) return;

    // タイマーベースのフラッシュをスケジュール
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, this.FLUSH_DELAY);
  }

  private async flush(): Promise<void> {
    const resolve = this.flushResolve;
    this.flushPromise = null;
    this.flushResolve = null;

    if (this.writeQueue.size === 0 && this.deleteQueue.size === 0) {
      resolve?.();
      return;
    }

    const items = new Map(this.writeQueue);
    const keysToDelete = new Set(this.deleteQueue);
    this.writeQueue.clear();
    this.deleteQueue.clear();

    try {
      if (chrome?.storage?.local) {
        if (items.size > 0) {
          const obj: Record<string, unknown> = {};
          for (const [key, value] of items) {
            obj[key] = value;
          }
          await chrome.storage.local.set(obj);
        }
        if (keysToDelete.size > 0) {
          await chrome.storage.local.remove(Array.from(keysToDelete));
        }
      }
    } catch {
      // chrome.storage.local unavailable or quota exceeded
      // フラッシュに失敗した場合はキューに戻してリトライ
      for (const [key, value] of items) {
        this.writeQueue.set(key, value);
      }
      for (const key of keysToDelete) {
        this.deleteQueue.add(key);
      }
      // 遅延後に再試行
      this.scheduleFlush();
      return;
    }
    resolve?.();
  }

  async waitForFlush(): Promise<void> {
    // タイマーがあればまずそれを待つ
    if (this.flushTimer) {
      await new Promise<void>((resolve) => {
        const checkComplete = () => {
          if (!this.flushTimer) {
            resolve();
          } else {
            setTimeout(checkComplete, 10);
          }
        };
        setTimeout(checkComplete, 10);
      });
    }
    await this.flushPromise;
  }

  static mapToEntries<K, V>(map: Map<K, V>): [K, V][] {
    return Array.from(map.entries());
  }

  static entriesToMap<K, V>(entries: [K, V][]): Map<K, V> {
    return new Map(entries);
  }
}
