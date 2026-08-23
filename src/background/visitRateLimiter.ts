const VISIT_RATE_LIMIT_MS = 5000;
const VISIT_RATE_LIMIT_TTL_MS = 60_000;
const VISIT_RATE_LIMIT_MAX_ENTRIES = 1000;

function getRateLimitKey(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

export class VisitRateLimiter {
  private map = new Map<string, number>();

  isRateLimited(url: string): boolean {
    const now = Date.now();
    const key = getRateLimitKey(url);

    this.sweep(now);

    const last = this.map.get(key);
    if (last !== undefined && now - last < VISIT_RATE_LIMIT_MS) return true;
    this.map.set(key, now);

    if (this.map.size > VISIT_RATE_LIMIT_MAX_ENTRIES) {
      const oldestKey = this.map.keys().next().value as string | undefined;
      if (oldestKey !== undefined) this.map.delete(oldestKey);
    }
    return false;
  }

  reset(): void {
    this.map.clear();
  }

  private sweep(now: number): void {
    for (const [k, ts] of this.map) {
      if (now - ts > VISIT_RATE_LIMIT_TTL_MS) this.map.delete(k);
    }
  }
}
