/**
 * visitRateLimiter.ts
 * Per-origin rate limiter for VALID_VISIT messages.
 *
 * Extracted from recordingHandlers.ts so the flood guard is an injectable,
 * testable instance rather than a raw module-level Map. The store is an
 * adapter seam (in-memory by default) so tests can swap it without relying on
 * global reset hooks.
 */

export interface VisitRateLimiterStore {
  get(key: string): number | undefined;
  set(key: string, timestamp: number): void;
  delete(key: string): void;
  keys(): IterableIterator<string>;
  clear(): void;
  readonly size: number;
}

/** Default in-memory store backed by a Map. */
export class MapVisitRateLimiterStore implements VisitRateLimiterStore {
  private map = new Map<string, number>();

  get(key: string): number | undefined {
    return this.map.get(key);
  }

  set(key: string, timestamp: number): void {
    this.map.set(key, timestamp);
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  keys(): IterableIterator<string> {
    return this.map.keys();
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

export class VisitRateLimiter {
  constructor(
    private readonly store: VisitRateLimiterStore = new MapVisitRateLimiterStore(),
    private readonly limitMs: number = 5000,
    private readonly ttlMs: number = 30_000,
    private readonly maxEntries: number = 1000,
  ) {}

  isRateLimited(url: string): boolean {
    const now = Date.now();
    const key = this.getRateLimitKey(url);

    // Evict entries older than TTL on every check so stale entries never
    // persist past TTL, regardless of store size.
    for (const k of this.store.keys()) {
      const ts = this.store.get(k);
      if (ts !== undefined && now - ts > this.ttlMs) this.store.delete(k);
    }

    const last = this.store.get(key);
    if (last !== undefined && now - last < this.limitMs) return true;
    this.store.set(key, now);

    // Safety net: even if the TTL sweep somehow falls behind, cap growth.
    if (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value as string | undefined;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    return false;
  }

  reset(): void {
    this.store.clear();
  }

  /**
   * VULN-002: derive the rate-limit key from the URL's origin so a hostile page
   * cannot bypass the throttle by rotating the path/fragment/query (pushState
   * only changes same-origin path/fragment). Different registrable hosts still
   * get distinct keys.
   */
  private getRateLimitKey(url: string): string {
    try {
      return new URL(url).origin;
    } catch {
      // Invalid URL: fall back to the raw string so it is still throttled.
      return url;
    }
  }
}

/** Default singleton for the VALID_VISIT handler. */
export const visitRateLimiter = new VisitRateLimiter();
