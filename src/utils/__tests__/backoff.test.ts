import { describe, it, expect } from 'vitest';
import { backoffDelayMs } from '../backoff.js';

/**
 * Parity pins for the backoff SSOT refactor (PBI 2026-09-17-09).
 * Each series reproduces a pre-refactor inline formula verbatim; changing any
 * value here is a behavior change and must be a separate, deliberate commit.
 */
describe('backoffDelayMs parity', () => {
  it('reproduces the MessageTransport series (100 * 2^attempt, cap 1000)', () => {
    const series = [0, 1, 2, 3, 4, 5].map((attempt) =>
      backoffDelayMs(attempt, { baseMs: 100, multiplier: 2, maxMs: 1000 }),
    );
    expect(series).toEqual([100, 200, 400, 800, 1000, 1000]);
  });

  it('reproduces the fetchWithRetry default series (1000 * 2^attempt, cap 10000)', () => {
    const series = [0, 1, 2, 3, 4, 5].map((attempt) =>
      backoffDelayMs(attempt, { baseMs: 1000, multiplier: 2, maxMs: 10000 }),
    );
    expect(series).toEqual([1000, 2000, 4000, 8000, 10000, 10000]);
  });

  it('reproduces the DashboardGateway constant delay via multiplier 1', () => {
    const series = [0, 1, 2, 3].map((attempt) =>
      backoffDelayMs(attempt, { baseMs: 1000, multiplier: 1 }),
    );
    expect(series).toEqual([1000, 1000, 1000, 1000]);
  });

  it('passes a custom constant delay through unclamped', () => {
    expect(backoffDelayMs(2, { baseMs: 250, multiplier: 1 })).toBe(250);
    expect(backoffDelayMs(0, { baseMs: 60000, multiplier: 1 })).toBe(60000);
  });

  it('matches the pre-refactor expression for arbitrary fetchWithRetry options', () => {
    const cases = [
      { initialDelayMs: 500, backoffMultiplier: 2, maxDelayMs: 3000 },
      { initialDelayMs: 100, backoffMultiplier: 3, maxDelayMs: 5000 },
    ];
    for (const c of cases) {
      for (let attempt = 0; attempt <= 5; attempt++) {
        const legacy = Math.min(
          c.initialDelayMs * Math.pow(c.backoffMultiplier, attempt),
          c.maxDelayMs,
        );
        expect(
          backoffDelayMs(attempt, {
            baseMs: c.initialDelayMs,
            multiplier: c.backoffMultiplier,
            maxMs: c.maxDelayMs,
          }),
        ).toBe(legacy);
      }
    }
  });
});
