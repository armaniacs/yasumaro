/**
 * stats.test.ts — pins the numeric behaviour of the harness statistics.
 */
// @ts-nocheck
import { describe, it, expect } from 'vitest';
import {
  percentile,
  median,
  mean,
  stddev,
  trimmedMean,
  scalingExponent,
  classifyExponent,
  summarize,
  percentDelta,
} from '../stats.mjs';

describe('percentile', () => {
  it('returns NaN for empty input', () => {
    expect(percentile([], 50)).toBeNaN();
  });

  it('returns the sole value for a single sample', () => {
    expect(percentile([42], 95)).toBe(42);
  });

  it('matches the R-7 convention on a known set', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(xs, 50)).toBe(5.5);
    expect(percentile(xs, 0)).toBe(1);
    expect(percentile(xs, 100)).toBe(10);
    // rank = 0.95 * 9 = 8.55 -> between index 8 (9) and 9 (10)
    expect(percentile(xs, 95)).toBeCloseTo(9.55, 10);
  });

  it('is order-independent', () => {
    expect(percentile([10, 1, 5, 3, 8], 50)).toBe(5);
  });
});

describe('median', () => {
  it('is percentile 50', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe('mean / stddev', () => {
  it('mean of empty is NaN', () => {
    expect(mean([])).toBeNaN();
  });

  it('stddev needs at least two samples', () => {
    expect(stddev([5])).toBe(0);
    expect(stddev([])).toBe(0);
  });

  it('computes sample stddev (n-1)', () => {
    // values 2,4,4,4,5,5,7,9 -> sample stddev = 2.138...
    expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 4);
  });
});

describe('trimmedMean', () => {
  it('drops the extreme tails', () => {
    const xs = [100, 1, 1, 1, 1, 1, 1, 1, 1, 1]; // one huge outlier
    // 10% trim removes one from each end -> the low 1 and the high 100
    expect(trimmedMean(xs, 0.1)).toBe(1);
  });

  it('falls back to plain mean for tiny samples', () => {
    expect(trimmedMean([2, 4], 0.1)).toBe(3);
  });
});

describe('scalingExponent', () => {
  it('reports linear for y = 3x', () => {
    const points = [10, 100, 1000, 10000].map((n) => ({ n, time: 3 * n }));
    const { exponent, verdict } = scalingExponent(points);
    expect(exponent).toBeCloseTo(1.0, 6);
    expect(verdict).toBe('linear');
  });

  it('reports quadratic for y = 0.5 x^2', () => {
    const points = [10, 100, 1000, 5000].map((n) => ({ n, time: 0.5 * n * n }));
    const { exponent, verdict } = scalingExponent(points);
    expect(exponent).toBeCloseTo(2.0, 6);
    expect(verdict).toBe('quadratic');
  });

  it('reports insufficient-data with one distinct size', () => {
    const { verdict } = scalingExponent([
      { n: 100, time: 5 },
      { n: 100, time: 6 },
    ]);
    expect(verdict).toBe('insufficient-data');
  });

  it('ignores non-positive timings', () => {
    const points = [
      { n: 10, time: 0 },
      { n: 100, time: 100 },
      { n: 1000, time: 1000 },
    ];
    const { verdict } = scalingExponent(points);
    expect(verdict).toBe('linear');
  });
});

describe('classifyExponent', () => {
  it('buckets the boundaries', () => {
    expect(classifyExponent(0.2)).toBe('sub-linear');
    expect(classifyExponent(1.0)).toBe('linear');
    expect(classifyExponent(1.5)).toBe('super-linear');
    expect(classifyExponent(2.0)).toBe('quadratic');
    expect(classifyExponent(3.1)).toBe('polynomial-or-worse');
    expect(classifyExponent(NaN)).toBe('unknown');
  });
});

describe('summarize', () => {
  it('produces the full stat block', () => {
    const s = summarize([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(s.count).toBe(10);
    expect(s.p50).toBe(5.5);
    expect(s.min).toBe(1);
    expect(s.max).toBe(10);
    expect(s.mean).toBe(5.5);
  });
});

describe('percentDelta', () => {
  it('positive means slower', () => {
    expect(percentDelta(100, 115)).toBeCloseTo(15, 10);
  });

  it('negative means faster', () => {
    expect(percentDelta(100, 60)).toBeCloseTo(-40, 10);
  });

  it('zero baseline with movement is Infinity', () => {
    expect(percentDelta(0, 5)).toBe(Infinity);
    expect(percentDelta(0, 0)).toBe(0);
  });
});
