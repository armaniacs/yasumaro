/**
 * visitDurationAggregate unit tests: null exclusion + ratio, top-N,
 * deterministic ties, legacy comma tag splitting, duration formatting.
 */
import { describe, it, expect } from 'vitest';
import {
  aggregateVisitDurations,
  formatVisitDuration,
  isMeasuredDuration,
  UNKNOWN_DOMAIN_LABEL,
  VISIT_DURATION_TOP_N,
  type VisitDurationInput,
} from '../../../visitDurationAggregate.js';

function row(domain: string | null, tags: string | null, visit_duration: number | null): VisitDurationInput {
  return { domain, tags, visit_duration };
}

describe('isMeasuredDuration', () => {
  it('accepts finite non-negative numbers only', () => {
    expect(isMeasuredDuration(0)).toBe(true);
    expect(isMeasuredDuration(12_000)).toBe(true);
    expect(isMeasuredDuration(null)).toBe(false);
    expect(isMeasuredDuration(undefined)).toBe(false);
    expect(isMeasuredDuration(NaN)).toBe(false);
    expect(isMeasuredDuration(Infinity)).toBe(false);
    expect(isMeasuredDuration(-5)).toBe(false);
    expect(isMeasuredDuration('3000')).toBe(false);
  });
});

describe('aggregateVisitDurations', () => {
  it('sums/averages/counts by domain sorted desc by total', () => {
    const agg = aggregateVisitDurations([
      row('a.com', null, 10_000),
      row('a.com', null, 30_000),
      row('b.com', null, 50_000),
    ]);
    expect(agg.totalCount).toBe(3);
    expect(agg.measuredCount).toBe(3);
    expect(agg.unmeasuredCount).toBe(0);
    expect(agg.unmeasuredRatio).toBe(0);
    expect(agg.domains).toHaveLength(2);
    expect(agg.domains[0]).toEqual({ name: 'b.com', totalMs: 50_000, avgMs: 50_000, count: 1 });
    expect(agg.domains[1]).toEqual({ name: 'a.com', totalMs: 40_000, avgMs: 20_000, count: 2 });
  });

  it('excludes null/invalid durations and reports the ratio', () => {
    const agg = aggregateVisitDurations([
      row('a.com', null, 60_000),
      row('b.com', null, null),
      row('c.com', null, NaN),
      row('d.com', null, -1),
    ]);
    expect(agg.totalCount).toBe(4);
    expect(agg.measuredCount).toBe(1);
    expect(agg.unmeasuredCount).toBe(3);
    expect(agg.unmeasuredRatio).toBeCloseTo(0.75);
    expect(agg.domains).toEqual([{ name: 'a.com', totalMs: 60_000, avgMs: 60_000, count: 1 }]);
  });

  it('returns empty rankings with zero ratio for empty input', () => {
    const agg = aggregateVisitDurations([]);
    expect(agg.domains).toEqual([]);
    expect(agg.tags).toEqual([]);
    expect(agg.unmeasuredRatio).toBe(0);
    expect(agg.domainsTruncated).toBe(false);
    expect(agg.tagsTruncated).toBe(false);
  });

  it('groups null/blank domains under the unknown label', () => {
    const agg = aggregateVisitDurations([
      row(null, null, 5_000),
      row('  ', null, 7_000),
    ]);
    expect(agg.domains).toEqual([
      { name: UNKNOWN_DOMAIN_LABEL, totalMs: 12_000, avgMs: 6_000, count: 2 },
    ]);
  });

  it('credits each tag with the full row duration', () => {
    const agg = aggregateVisitDurations([
      row('a.com', '#x #y', 30_000),
      row('b.com', '#x', 10_000),
    ]);
    expect(agg.tags).toEqual([
      { name: 'x', totalMs: 40_000, avgMs: 20_000, count: 2 },
      { name: 'y', totalMs: 30_000, avgMs: 30_000, count: 1 },
    ]);
  });

  it('splits legacy comma-joined tags and dedupes repeats within a row', () => {
    const agg = aggregateVisitDurations([row('a.com', 'alpha,alpha,beta', 9_000)]);
    expect(agg.tags).toEqual([
      { name: 'alpha', totalMs: 9_000, avgMs: 9_000, count: 1 },
      { name: 'beta', totalMs: 9_000, avgMs: 9_000, count: 1 },
    ]);
  });

  it('truncates to top-N with flags and keeps defaults at 20', () => {
    expect(VISIT_DURATION_TOP_N).toBe(20);
    const rows = Array.from({ length: 25 }, (_, i) =>
      row(`d${i}.com`, `#t${i}`, (i + 1) * 1_000),
    );
    const agg = aggregateVisitDurations(rows);
    expect(agg.domains).toHaveLength(20);
    expect(agg.domainsTruncated).toBe(true);
    expect(agg.tagsTruncated).toBe(true);
    expect(agg.domains[0]!.name).toBe('d24.com');
    expect(agg.domainTotal).toBe(25);
    expect(agg.tagTotal).toBe(25);
    const small = aggregateVisitDurations(rows.slice(0, 3));
    expect(small.domainsTruncated).toBe(false);
    expect(small.tagsTruncated).toBe(false);
  });

  it('orders ties by count desc then name asc', () => {
    const agg = aggregateVisitDurations([
      row('b.com', null, 10_000),
      row('a.com', null, 5_000),
      row('a.com', null, 5_000),
      row('c.com', null, 10_000),
    ]);
    // a.com and b.com tie at 10_000 total; a.com has the higher count.
    expect(agg.domains.map((d) => d.name)).toEqual(['a.com', 'b.com', 'c.com']);
  });
});

describe('formatVisitDuration', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatVisitDuration(0)).toBe('0s');
    expect(formatVisitDuration(5_000)).toBe('5s');
    expect(formatVisitDuration(59_000)).toBe('59s');
    expect(formatVisitDuration(60_000)).toBe('1 min');
    expect(formatVisitDuration(90_000)).toBe('1.5 min');
    expect(formatVisitDuration(3_600_000)).toBe('1 h');
    expect(formatVisitDuration(5_400_000)).toBe('1.5 h');
  });

  it('clamps invalid input to 0s', () => {
    expect(formatVisitDuration(NaN)).toBe('0s');
    expect(formatVisitDuration(-100)).toBe('0s');
    expect(formatVisitDuration(Infinity)).toBe('0s');
  });
});
