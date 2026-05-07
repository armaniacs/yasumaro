export const SESSION_KEYS = {
  SKIP_AI_RATE_LIMITER: 'sw:rateLimiter',
  TAB_CACHE: 'sw:tabCache',
  RECORDING_CACHE: 'sw:recordingCache',
} as const;

export class SessionStore {
  private writeQueue = new Map<string, unknown>();
  private flushResolve: (() => void) | null = null;
  private flushPromise: Promise<void> | null = null;

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
    this.writeQueue.set(key, value);
    this.scheduleFlush();
  }

  remove(key: string): void {
    this.writeQueue.delete(key);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushPromise) return;
    this.flushPromise = new Promise<void>((resolve) => {
      this.flushResolve = resolve;
      queueMicrotask(() => {
        this.flush();
      });
    });
  }

  private async flush(): Promise<void> {
    const resolve = this.flushResolve;
    this.flushPromise = null;
    this.flushResolve = null;
    if (this.writeQueue.size === 0) {
      resolve?.();
      return;
    }
    const items = new Map(this.writeQueue);
    this.writeQueue.clear();
    try {
      if (chrome?.storage?.session) {
        const obj: Record<string, unknown> = {};
        for (const [key, value] of items) {
          obj[key] = value;
        }
        await chrome.storage.session.set(obj);
      }
    } catch {
      // chrome.storage.session unavailable or quota exceeded
    }
    resolve?.();
  }

  async waitForFlush(): Promise<void> {
    await this.flushPromise;
  }

  static mapToEntries<K, V>(map: Map<K, V>): [K, V][] {
    return Array.from(map.entries());
  }

  static entriesToMap<K, V>(entries: [K, V][]): Map<K, V> {
    return new Map(entries);
  }
}
