/**
 * tagFrequencyTimeline unit tests (PBI 2026-09-24-05).
 * All timestamps are built from local Date components so the assertions hold
 * in any timezone (the bucketing itself is specified in local time).
 * Reference weekdays (verified): 2026-09-20 = Sunday, 09-23 = Wednesday,
 * 09-30 = Wednesday, 2026-10-01 = Thursday, 2026-10-04 = Sunday.
 */
import { describe, it, expect } from 'vitest';
import {
  computeTagFrequencyTimeline,
  startOfLocalWeek,
  startOfLocalMonth,
  formatBucketDate,
  TIMELINE_MAX_TOP_N,
} from '../tagFrequencyTimeline.js';

function at(year: number, month1: number, day: number, hour = 12): number {
  return new Date(year, month1 - 1, day, hour, 0, 0, 0).getTime();
}

function row(tags: string | null, ts: number): { tags: string | null; created_at: number } {
  return { tags, created_at: ts };
}

describe('startOfLocalWeek / startOfLocalMonth', () => {
  it('snaps any weekday back to the local Sunday midnight', () => {
    const sunday = at(2026, 9, 20, 15);
    expect(new Date(startOfLocalWeek(sunday)).getDay()).toBe(0);
    expect(startOfLocalWeek(at(2026, 9, 23, 10))).toBe(at(2026, 9, 20, 0));
    expect(startOfLocalWeek(at(2026, 9, 26, 23))).toBe(at(2026, 9, 20, 0));
    expect(startOfLocalWeek(at(2026, 9, 27, 0))).toBe(at(2026, 9, 27, 0));
  });

  it('snaps to local midnight of the 1st across month boundaries', () => {
    expect(startOfLocalMonth(at(2026, 9, 30, 18))).toBe(at(2026, 9, 1, 0));
    expect(startOfLocalMonth(at(2026, 10, 1, 0))).toBe(at(2026, 10, 1, 0));
    expect(new Date(startOfLocalMonth(at(2026, 10, 4))).getDate()).toBe(1);
  });
});

describe('computeTagFrequencyTimeline — weekly buckets', () => {
  it('buckets records into Sunday-start weeks and labels with the start date', () => {
    const timeline = computeTagFrequencyTimeline(
      [
        row('#a', at(2026, 9, 23)), // Wed of week starting Sun 09-20
        row('#a', at(2026, 9, 26)), // Sat, same week
        row('#b', at(2026, 9, 28)), // Mon of week starting Sun 09-27
      ],
      { granularity: 'week' },
    );
    expect(timeline.buckets.map((b) => formatBucketDate(b.start))).toEqual([
      '2026-09-20',
      '2026-09-27',
    ]);
    expect(timeline.buckets[0]!.counts).toEqual({ a: 2 });
    expect(timeline.buckets[1]!.counts).toEqual({ b: 1 });
    for (const bucket of timeline.buckets) {
      expect(new Date(bucket.start).getDay()).toBe(0);
      expect(new Date(bucket.start).getHours()).toBe(0);
    }
  });

  it('keeps a partial first/last bucket instead of truncating it', () => {
    // Data spans Wed 09-23 .. Sat 09-26 — a fraction of the week starting 09-20.
    const timeline = computeTagFrequencyTimeline(
      [row('#a', at(2026, 9, 23)), row('#a', at(2026, 9, 26))],
      { granularity: 'week' },
    );
    expect(timeline.buckets).toHaveLength(1);
    expect(formatBucketDate(timeline.buckets[0]!.start)).toBe('2026-09-20');
    // A single mid-week record forms a one-bucket (partial) week too.
    const single = computeTagFrequencyTimeline([row('#a', at(2026, 9, 23))], {
      granularity: 'week',
    });
    expect(single.buckets).toHaveLength(1);
    expect(formatBucketDate(single.buckets[0]!.start)).toBe('2026-09-20');
  });

  it('week boundary: Sat 09-26 and Sun 09-27 land in different buckets', () => {
    const timeline = computeTagFrequencyTimeline(
      [row('#a', at(2026, 9, 26, 23)), row('#a', at(2026, 9, 27, 1))],
      { granularity: 'week' },
    );
    expect(timeline.buckets.map((b) => formatBucketDate(b.start))).toEqual([
      '2026-09-20',
      '2026-09-27',
    ]);
  });

  it('end is the nominal next bucket start (exclusive)', () => {
    const timeline = computeTagFrequencyTimeline([row('#a', at(2026, 9, 23))], {
      granularity: 'week',
    });
    expect(timeline.buckets[0]!.end).toBe(at(2026, 9, 27, 0));
  });
});

describe('computeTagFrequencyTimeline — monthly buckets', () => {
  it('buckets by calendar month across the Sep/Oct boundary', () => {
    const timeline = computeTagFrequencyTimeline(
      [
        row('#a', at(2026, 9, 30, 23)),
        row('#a', at(2026, 10, 1, 0)),
        row('#b', at(2026, 9, 5)),
      ],
      { granularity: 'month' },
    );
    expect(timeline.buckets.map((b) => formatBucketDate(b.start))).toEqual([
      '2026-09-01',
      '2026-10-01',
    ]);
    expect(timeline.buckets[0]!.counts).toEqual({ a: 1, b: 1 });
    expect(timeline.buckets[1]!.counts).toEqual({ a: 1 });
  });
});

describe('computeTagFrequencyTimeline — top-N and other aggregation', () => {
  it('aggregates tags beyond top N into the other bucket and flags hasOther', () => {
    const rows = [
      row('#a #c', at(2026, 9, 21)),
      row('#a', at(2026, 9, 22)),
      row('#a', at(2026, 9, 23)),
      row('#b', at(2026, 9, 23)),
      row('#b', at(2026, 9, 24)),
      row('#c', at(2026, 9, 25)),
      row('#d', at(2026, 9, 25)),
      row('#d', at(2026, 9, 26)),
    ];
    const timeline = computeTagFrequencyTimeline(rows, { granularity: 'week', topN: 2 });
    // Totals: a=3, b=2, d=2, c=2 — ties break by name asc, so top-2 = a, b.
    expect(timeline.tags).toEqual(['a', 'b']);
    expect(timeline.hasOther).toBe(true);
    const week = timeline.buckets[0]!;
    expect(week.counts).toEqual({ a: 3, b: 2 });
    expect(week.otherCount).toBe(4); // c:2 + d:2
  });

  it('omits the other bucket entirely when every tag fits within N', () => {
    const timeline = computeTagFrequencyTimeline(
      [row('#a #b', at(2026, 9, 21))],
      { granularity: 'week', topN: 10 },
    );
    expect(timeline.tags).toEqual(['a', 'b']);
    expect(timeline.hasOther).toBe(false);
    expect(timeline.buckets[0]!.otherCount).toBe(0);
  });

  it('orders tags by count desc then name asc and buckets chronologically', () => {
    const rows = [
      row('#zz #aa #mm', at(2026, 10, 4)),
      row('#zz #aa', at(2026, 9, 21)),
      row('#zz', at(2026, 9, 22)),
    ];
    const timeline = computeTagFrequencyTimeline(rows, { granularity: 'month', topN: 3 });
    // Totals: zz=3, aa=2, mm=1.
    expect(timeline.tags).toEqual(['zz', 'aa', 'mm']);
    const starts = timeline.buckets.map((b) => b.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it('counts each distinct tag once per record and absorbs legacy comma lists', () => {
    const timeline = computeTagFrequencyTimeline(
      [row('#a #a #b', at(2026, 9, 21)), row('c, d', at(2026, 9, 21))],
      { granularity: 'week', topN: 2 },
    );
    // topN=2 keeps a and b (ties break by name asc); the comma-parsed c and d
    // fall into the other bucket.
    expect(timeline.tags).toEqual(['a', 'b']);
    expect(timeline.buckets[0]!.counts).toEqual({ a: 1, b: 1 });
    expect(timeline.buckets[0]!.otherCount).toBe(2);
    expect(timeline.hasOther).toBe(true);
  });

  it('skips records without tags and records with invalid timestamps', () => {
    const timeline = computeTagFrequencyTimeline(
      [row(null, at(2026, 9, 21)), row('   ', at(2026, 9, 21)), row('#a', Number.NaN)],
      { granularity: 'week' },
    );
    expect(timeline.buckets).toEqual([]);
    expect(timeline.tags).toEqual([]);
    expect(timeline.hasOther).toBe(false);
  });
});

describe('computeTagFrequencyTimeline — caps and empty input', () => {
  it('clamps topN into [1, TIMELINE_MAX_TOP_N]', () => {
    const rows = Array.from({ length: TIMELINE_MAX_TOP_N + 10 }, (_, i) =>
      row(`#t${String(i).padStart(3, '0')}`, at(2026, 9, 21)),
    );
    const overcap = computeTagFrequencyTimeline(rows, { granularity: 'week', topN: 1000 });
    expect(overcap.tags).toHaveLength(TIMELINE_MAX_TOP_N);
    expect(overcap.hasOther).toBe(true);
    const zero = computeTagFrequencyTimeline(rows, { granularity: 'week', topN: 0 });
    expect(zero.tags).toHaveLength(1);
    expect(zero.hasOther).toBe(true);
    const nonFinite = computeTagFrequencyTimeline(rows, { granularity: 'week', topN: Number.NaN });
    expect(nonFinite.tags).toHaveLength(10); // TIMELINE_DEFAULT_TOP_N
  });

  it('returns an empty timeline for empty input', () => {
    const timeline = computeTagFrequencyTimeline([], { granularity: 'week' });
    expect(timeline).toEqual({ granularity: 'week', tags: [], hasOther: false, buckets: [] });
  });
});
