// @vitest-environment jsdom
/**
 * periodSplit unit tests (PBI 2026-09-24-08): half boundaries, shared mid
 * instant, inversion swap, zero-length windows, and non-finite rejection.
 */
import { describe, it, expect } from 'vitest';
import { splitPeriodInHalves } from '../periodSplit.js';

describe('splitPeriodInHalves', () => {
  it('splits an even-length window at the exact midpoint', () => {
    expect(splitPeriodInHalves(0, 10)).toEqual({
      first: { since: 0, until: 5 },
      second: { since: 5, until: 10 },
    });
  });

  it('floors the midpoint for odd-length windows', () => {
    expect(splitPeriodInHalves(0, 9)).toEqual({
      first: { since: 0, until: 4 },
      second: { since: 4, until: 9 },
    });
  });

  it('keeps the mid instant shared by both halves', () => {
    const { first, second } = splitPeriodInHalves(1000, 9001)!;
    expect(first.until).toBe(second.since);
    expect(first.since).toBe(1000);
    expect(second.until).toBe(9001);
  });

  it('swaps an inverted window (since > until)', () => {
    expect(splitPeriodInHalves(10, 0)).toEqual(splitPeriodInHalves(0, 10));
  });

  it('degenerates to two identical zero-length halves when since equals until', () => {
    expect(splitPeriodInHalves(5, 5)).toEqual({
      first: { since: 5, until: 5 },
      second: { since: 5, until: 5 },
    });
  });

  it('returns null for non-finite bounds', () => {
    expect(splitPeriodInHalves(NaN, 10)).toBeNull();
    expect(splitPeriodInHalves(0, NaN)).toBeNull();
    expect(splitPeriodInHalves(Infinity, 0)).toBeNull();
    expect(splitPeriodInHalves(0, -Infinity)).toBeNull();
  });

  it('handles negative epoch values symmetrically', () => {
    expect(splitPeriodInHalves(-10, -1)).toEqual({
      first: { since: -10, until: -6 },
      second: { since: -6, until: -1 },
    });
  });
});
