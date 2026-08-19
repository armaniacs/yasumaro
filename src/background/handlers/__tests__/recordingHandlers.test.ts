/**
 * recordingHandlers.test.ts
 * Direct unit tests for module-scoped rate-limit helpers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isRateLimitedVisit, resetVisitRateLimiter } from '../recordingHandlers.js';

describe('isRateLimitedVisit', () => {
  beforeEach(() => {
    resetVisitRateLimiter();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sweeps expired entries on every call even when size is below MAX_ENTRIES', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);

    // Register 997 fresh entries.
    for (let i = 0; i < 997; i++) {
      isRateLimitedVisit(`https://site-${i}.example.com/page`);
    }

    // Move past TTL, then add one fresh entry at the new time.
    vi.advanceTimersByTime(30_001);
    isRateLimitedVisit('https://fresh.example.com/page');

    // Call with a new origin: this must unconditionally sweep the 997 expired entries.
    isRateLimitedVisit('https://new-origin.example.com/page');

    // The expired origin should now be allowed again because its entry was swept.
    expect(isRateLimitedVisit('https://site-0.example.com/page')).toBe(false);
    // The fresh entry should still be rate-limited.
    expect(isRateLimitedVisit('https://fresh.example.com/page')).toBe(true);
  });

  it('still enforces the 5-second rate-limit window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);

    isRateLimitedVisit('https://same-origin.example.com/page');
    expect(isRateLimitedVisit('https://same-origin.example.com/page')).toBe(true);

    vi.advanceTimersByTime(5001);
    expect(isRateLimitedVisit('https://same-origin.example.com/page')).toBe(false);
  });

  it('evicts the oldest entry when size still exceeds MAX_ENTRIES after TTL sweep', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);

    // Pre-fill beyond the safeguard cap; all entries are within TTL.
    for (let i = 0; i < 1001; i++) {
      isRateLimitedVisit(`https://site-${i}.example.com/page`);
    }

    // The oldest entry should have been evicted by the safeguard.
    expect(isRateLimitedVisit('https://site-0.example.com/page')).toBe(false);
  });

  it('does not trigger the oldest-entry safeguard when TTL sweep already shrinks the map', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);

    // Pre-fill more than MAX_ENTRIES entries.
    for (let i = 0; i < 1050; i++) {
      isRateLimitedVisit(`https://site-${i}.example.com/page`);
    }

    // Let all of them expire.
    vi.advanceTimersByTime(30_001);

    // Add a small batch of fresh entries so the map is still below the cap after sweep.
    for (let i = 1050; i < 1090; i++) {
      isRateLimitedVisit(`https://site-${i}.example.com/page`);
    }

    // This call sweeps 1050 expired entries, leaving 41 fresh ones.
    expect(isRateLimitedVisit('https://final-origin.example.com/page')).toBe(false);

    // The first fresh entry should still be rate-limited (within the 5s window).
    expect(isRateLimitedVisit('https://site-1050.example.com/page')).toBe(true);
  });

  it('sweeps 1000 entries in less than 50ms (median of 3 runs)', () => {
    vi.useRealTimers();

    // Pre-fill the map with the intended maximum size.
    for (let i = 0; i < 1000; i++) {
      isRateLimitedVisit(`https://perf-${i}.example.com/page`);
    }

    const times: number[] = [];
    for (let run = 0; run < 3; run++) {
      const start = performance.now();
      isRateLimitedVisit('https://perf-bench.example.com/page');
      const end = performance.now();
      times.push(end - start);
    }

    times.sort();
    const median = times[1];
    expect(median).toBeLessThan(50);
  });
});
