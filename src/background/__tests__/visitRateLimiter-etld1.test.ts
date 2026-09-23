/**
 * visitRateLimiter-etld1.test.ts
 * Regression tests for eTLD+1-scoped visit throttling: sibling subdomains
 * share one window, special hosts keep port-suffixed origin keys.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { VisitRateLimiter, MapVisitRateLimiterStore } from '../visitRateLimiter.js';

function makeLimiter(): VisitRateLimiter {
  return new VisitRateLimiter(new MapVisitRateLimiterStore(), 5000, 30_000, 1000);
}

describe('VisitRateLimiter eTLD+1 scoping', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('throttles a same-origin revisit inside the window and allows it after expiry', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const limiter = makeLimiter();

    expect(limiter.isRateLimited('https://example.com/page')).toBe(false);
    expect(limiter.isRateLimited('https://example.com/other')).toBe(true);

    vi.advanceTimersByTime(5001);
    expect(limiter.isRateLimited('https://example.com/again')).toBe(false);
  });

  it('throttles the 2nd+ of 5 sibling subdomains in one shared window', () => {
    const limiter = makeLimiter();
    const subs = ['a', 'b', 'c', 'd', 'e'].map((s) => `https://${s}.example.com/page`);
    const results = subs.map((url) => limiter.isRateLimited(url));
    expect(results).toEqual([false, true, true, true, true]);
  });

  it('still throttles path/query rotation on one host', () => {
    const limiter = makeLimiter();
    expect(limiter.isRateLimited('https://example.com/a')).toBe(false);
    expect(limiter.isRateLimited('https://example.com/b?x=1#frag')).toBe(true);
  });

  it('keeps different ports on one host in the same window', () => {
    const limiter = makeLimiter();
    expect(limiter.isRateLimited('https://example.com:8443/page')).toBe(false);
    expect(limiter.isRateLimited('https://example.com/page')).toBe(true);
  });

  it('keys localhost by port-suffixed origin, not eTLD+1', () => {
    const limiter = makeLimiter();
    expect(limiter.isRateLimited('http://localhost:27123/page')).toBe(false);
    expect(limiter.isRateLimited('http://localhost:9999/page')).toBe(false);
    expect(limiter.isRateLimited('http://localhost:27123/other')).toBe(true);
  });

  it('keys IPv4 literals by origin with consistent port handling', () => {
    const limiter = makeLimiter();
    expect(limiter.isRateLimited('http://127.0.0.1:8080/page')).toBe(false);
    expect(limiter.isRateLimited('http://127.0.0.1:9090/page')).toBe(false);
    expect(limiter.isRateLimited('http://127.0.0.1:8080/other')).toBe(true);
  });

  it('keys IPv6 literals by the literal, not eTLD+1', () => {
    const limiter = makeLimiter();
    expect(limiter.isRateLimited('http://[::1]:8080/page')).toBe(false);
    expect(limiter.isRateLimited('http://[::1]:8080/other')).toBe(true);
    expect(limiter.isRateLimited('http://[::1]:9090/page')).toBe(false);
  });

  it('falls back to the raw string for invalid URLs', () => {
    const limiter = makeLimiter();
    expect(limiter.isRateLimited('not-a-url')).toBe(false);
    expect(limiter.isRateLimited('not-a-url')).toBe(true);
    expect(limiter.isRateLimited('another-broken-{{url')).toBe(false);
  });

  it('documents the tradeoff: unrelated tenants of one registrable domain share a window', () => {
    const limiter = makeLimiter();
    expect(limiter.isRateLimited('https://customer-a.cdn-example.com/page')).toBe(false);
    expect(limiter.isRateLimited('https://customer-b.cdn-example.com/page')).toBe(true);
  });
});
