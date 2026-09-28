/**
 * localDate.test.ts
 *
 * Unit tests for the localDate SSOT (PBI 2026-09-28-11).
 *
 * Every assertion is timezone-independent by construction: fixtures are built
 * from local date components via the numeric Date constructor (specified to
 * read the local zone) and the expected values are derived the same way, so
 * the suite gives the same result in any TZ. No fixed-time waits.
 */
import { describe, it, expect } from 'vitest';
import {
  formatLocalDate,
  formatLocalDateString,
  parseLocalDateStart,
  startOfLocalDayMs,
  endOfLocalDayMs,
  localDayRangeFromDateString,
  DAY_MS,
} from '../localDate.js';

/** Local-midnight Date for Y/M/D (month 1-based), the TZ-independent fixture. */
function localDate(year: number, month1: number, day: number, hours = 0, minutes = 0, seconds = 0, ms = 0): Date {
  return new Date(year, month1 - 1, day, hours, minutes, seconds, ms);
}

const HOUR_MS = 3_600_000;

describe('formatLocalDateString', () => {
  it('zero-pads month and day but not the year', () => {
    expect(formatLocalDateString(localDate(2026, 1, 5).getTime())).toBe('2026-01-05');
    expect(formatLocalDateString(localDate(2026, 12, 31).getTime())).toBe('2026-12-31');
  });

  it('formats local midnight as that day, not the previous one', () => {
    // A bare `new Date('2026-03-31')` is UTC midnight and lands on the previous
    // local day west of Greenwich; local components must not move.
    expect(formatLocalDateString(localDate(2026, 3, 31, 0, 0, 0, 0).getTime())).toBe('2026-03-31');
  });

  it('formats the last millisecond of a day as the same day', () => {
    expect(formatLocalDateString(localDate(2026, 6, 15, 23, 59, 59, 999).getTime())).toBe('2026-06-15');
  });

  it('crosses a year boundary on local time, not on 24h buckets', () => {
    expect(formatLocalDateString(localDate(2026, 12, 31, 23, 59, 59, 999).getTime())).toBe('2026-12-31');
    expect(formatLocalDateString(localDate(2027, 1, 1, 0, 0, 0, 0).getTime())).toBe('2027-01-01');
  });

  it('handles a month end and a leap day', () => {
    expect(formatLocalDateString(localDate(2026, 2, 28).getTime())).toBe('2026-02-28');
    expect(formatLocalDateString(localDate(2028, 2, 29).getTime())).toBe('2028-02-29');
  });
});

describe('formatLocalDate', () => {
  it('matches formatLocalDateString for the same instant', () => {
    const d = localDate(2026, 8, 8, 13, 45, 30, 250);
    expect(formatLocalDate(d)).toBe(formatLocalDateString(d.getTime()));
    expect(formatLocalDate(d)).toBe('2026-08-08');
  });
});

describe('parseLocalDateStart', () => {
  it('parses a date string to LOCAL midnight', () => {
    expect(parseLocalDateStart('2026-08-08')).toBe(localDate(2026, 8, 8, 0, 0, 0, 0).getTime());
  });

  it('returns NaN for an empty value so callers read it as "no bound"', () => {
    expect(parseLocalDateStart('')).toBeNaN();
  });

  it('returns NaN for an unparseable value', () => {
    expect(parseLocalDateStart('not-a-date')).toBeNaN();
  });

  it('accepts a non-existent date by normalizing (lenient policy)', () => {
    // Deliberate contrast with archiveGuards.cutoffMsFromLocalDate, which
    // throws for the same input. Both contracts are kept on purpose.
    expect(parseLocalDateStart('2026-02-30')).toBe(localDate(2026, 3, 2, 0, 0, 0, 0).getTime());
  });

  it('round-trips a formatted date back to the same local day', () => {
    for (const [y, m, d] of [[2026, 1, 1], [2026, 8, 8], [2026, 12, 31], [2027, 3, 15]] as const) {
      const formatted = formatLocalDateString(localDate(y, m, d, 17, 30).getTime());
      expect(formatLocalDateString(parseLocalDateStart(formatted))).toBe(formatted);
    }
  });
});

describe('startOfLocalDayMs / endOfLocalDayMs', () => {
  it('bounds the local day containing the timestamp', () => {
    const noon = localDate(2026, 8, 8, 12).getTime();
    expect(startOfLocalDayMs(noon)).toBe(localDate(2026, 8, 8, 0, 0, 0, 0).getTime());
    expect(endOfLocalDayMs(noon)).toBe(localDate(2026, 8, 8, 23, 59, 59, 999).getTime());
  });

  it('keeps the end inside its own day for every millisecond', () => {
    const start = startOfLocalDayMs(localDate(2026, 11, 3, 5).getTime());
    for (const ts of [start, start + 1, start + DAY_MS / 2]) {
      expect(formatLocalDateString(endOfLocalDayMs(ts))).toBe(formatLocalDateString(ts));
    }
  });
});

describe('localDayRangeFromDateString', () => {
  it('spans the whole local day of the given date', () => {
    const range = localDayRangeFromDateString('2026-08-08');
    expect(range.since).toBe(localDate(2026, 8, 8, 0, 0, 0, 0).getTime());
    expect(range.until).toBe(localDate(2026, 8, 8, 23, 59, 59, 999).getTime());
  });

  it('emits NaN bounds for an empty date string', () => {
    const range = localDayRangeFromDateString('');
    expect(range.since).toBeNaN();
    expect(range.until).toBeNaN();
  });
});

describe('DST-correct day ranges', () => {
  /**
   * Walks every local day of 2026 and returns its inclusive range. Each day is
   * constructed on its own from the numeric Date constructor (local zone, with
   * day-overflow handling the calendar roll) — incrementing a cursor would
   * permanently drift in zones whose DST transition lands on local midnight,
   * where 00:00 does not exist. The generic form is what makes the assertions
   * below run in any timezone: the runner's zone decides which days are
   * shifted, and the invariants must hold either way.
   */
  function everyLocalDayOf2026(): Array<{ date: string; since: number; until: number; lengthMs: number }> {
    const days: Array<{ date: string; since: number; until: number; lengthMs: number }> = [];
    for (let i = 0; i < 366; i++) {
      const since = new Date(2026, 0, 1 + i).getTime();
      const until = endOfLocalDayMs(since);
      days.push({ date: formatLocalDateString(since), since, until, lengthMs: until - since });
    }
    return days;
  }

  it('ends every local day at 23:59:59.999 of that same day', () => {
    for (const day of everyLocalDayOf2026()) {
      expect(formatLocalDateString(day.until)).toBe(day.date);
      expect(new Date(day.until).getHours()).toBe(23);
      expect(new Date(day.until).getMinutes()).toBe(59);
      expect(new Date(day.until).getSeconds()).toBe(59);
      expect(new Date(day.until).getMilliseconds()).toBe(999);
    }
  });

  it('never spills a day range into the next local day', () => {
    // The 23h half of the bug: `since + 86_400_000 - 1` runs an hour past
    // local end-of-day on a spring-forward day, so the next day's records
    // leak into this day's view.
    const days = everyLocalDayOf2026();
    for (let i = 0; i + 1 < days.length; i++) {
      const next = localDayRangeFromDateString(days[i + 1].date);
      expect(days[i].until).toBeLessThan(next.since);
    }
  });

  it('never produces a day longer than 25h or shorter than 23h', () => {
    // A 23h/25h day measures one millisecond under its nominal length here,
    // because `until` is the inclusive last millisecond, not the next midnight.
    for (const day of everyLocalDayOf2026()) {
      expect(day.lengthMs).toBeLessThanOrEqual(25 * HOUR_MS - 1);
      expect(day.lengthMs).toBeGreaterThanOrEqual(23 * HOUR_MS - 1);
    }
  });

  it('covers a DST-shifted day (23h/25h, or a half-hour shift) exactly', () => {
    // Vacuous in a fixed-offset zone (UTC, JST, IST), where no day is shifted
    // and the generic invariants above are the whole coverage.
    const days = everyLocalDayOf2026();
    const shifted = days.filter((d) => d.lengthMs !== DAY_MS - 1);
    for (const day of shifted) {
      // A DST transition moves a day by at most two hours; the half-hour zones
      // (Lord Howe, Chatham) sit in between, so bound rather than pin.
      expect(Math.abs(day.lengthMs - (DAY_MS - 1))).toBeLessThanOrEqual(2 * HOUR_MS);
      expect(day.until).toBe(endOfLocalDayMs(day.since));
      // The regression this pins: on a shifted day the end must NOT be the old
      // fixed-offset `since + 86_400_000 - 1`, which truncates a 25h day by an
      // hour and over-runs a 23h one into the next day.
      expect(day.until).not.toBe(day.since + DAY_MS - 1);
    }
  });
});

/**
 * Parity with the inline implementations this module replaced (PBI
 * 2026-09-28-11). The bodies below are verbatim copies of the code that used
 * to live in markdownExport, tagFrequencyTimeline, tagClusterTimeSliderPanel,
 * sqliteHistoryPanelView, archivePanel, localMarkdownIdleFlusher,
 * MarkdownBufferManager and the five `new Date(x + 'T00:00:00')` parse sites,
 * so any drift in the SSOT shows up as a failing equality here.
 */
describe('parity with the pre-migration inline implementations', () => {
  /** markdownExport.getLocalDateString / tagFrequencyTimeline.formatBucketDate / … */
  function oldFormatFromTimestamp(timestamp: number): string {
    const d = new Date(timestamp);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /** sqliteHistoryPanelView.formatDate — the `Date`-accepting variant. */
  function oldFormatFromDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /** archivePanel.isoToday */
  function oldIsoToday(now: number): string {
    const d = new Date(now);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** periodFilter.parseDateInput and all five `new Date(x + 'T00:00:00')` copies. */
  function oldParse(value: string): number {
    if (!value) return NaN;
    return new Date(value + 'T00:00:00').getTime();
  }

  /** localMarkdownIdleFlusher.getYesterdayDateString */
  function oldYesterday(now: number): string {
    return oldFormatFromTimestamp(now - DAY_MS);
  }

  /** A spread of representative local instants: month end, year end, midnight, leap day. */
  const samples = [
    localDate(2026, 1, 1, 0, 0, 0, 0),
    localDate(2026, 1, 1, 0, 0, 0, 1),
    localDate(2026, 2, 28, 23, 59, 59, 999),
    localDate(2028, 2, 29, 12),
    localDate(2026, 6, 15, 13, 45, 30, 250),
    localDate(2026, 10, 31, 6, 30),
    localDate(2026, 12, 31, 23, 59, 59, 999),
    localDate(2027, 1, 1, 0, 0, 0, 0),
  ];

  it('formats every representative instant exactly as the old inline copies did', () => {
    for (const sample of samples) {
      expect(formatLocalDateString(sample.getTime())).toBe(oldFormatFromTimestamp(sample.getTime()));
      expect(formatLocalDate(sample)).toBe(oldFormatFromDate(sample));
      expect(formatLocalDateString(sample.getTime())).toBe(oldIsoToday(sample.getTime()));
    }
  });

  it("produces yesterday's string exactly as localMarkdownIdleFlusher did", () => {
    for (const sample of samples) {
      expect(formatLocalDateString(sample.getTime() - DAY_MS)).toBe(oldYesterday(sample.getTime()));
    }
  });

  it('parses every date string exactly as the old parse copies did', () => {
    for (const value of ['2026-01-01', '2026-08-08', '2026-12-31', '2028-02-29', '2026-02-30', 'not-a-date', '']) {
      const actual = parseLocalDateStart(value);
      const expected = oldParse(value);
      if (Number.isNaN(expected)) expect(actual).toBeNaN();
      else expect(actual).toBe(expected);
    }
  });

  it('keeps the day-range start identical to the old parse copy', () => {
    // The end is deliberately NOT pinned to the old `since + 86_400_000 - 1`:
    // that is the DST bug. The DST block above covers the end instead.
    for (const value of ['2026-01-01', '2026-08-08', '2026-12-31', '2026-03-08', '2026-11-01']) {
      const range = localDayRangeFromDateString(value);
      expect(range.since).toBe(oldParse(value));
      expect(range.until).toBe(endOfLocalDayMs(range.since));
    }
  });
});
