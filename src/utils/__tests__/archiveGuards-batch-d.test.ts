/**
 * archiveGuards-batch-d.test.ts — PBI 2026-11-08-16 (item 5) + PBI
 * 2026-11-08-17 (items 5, 6) pins.
 *
 * (16-5) The +2 day future grace is the named ARCHIVE_CUTOFF_FUTURE_TOLERANCE_MS
 * over the shared day unit, with the boundary (+1 day accepted, +3 days
 * rejected) pinned under a fake clock. The exact +2d instant is deliberately
 * NOT pinned: date-granularity cutoffs straddle it by time of day.
 * (17-5) The 2000-01-01 lower bound is UTC midnight, so the earliest
 * acceptable dates do not shift with the host timezone (TZ-safe choices:
 * 2000-01-01 accepted everywhere, 1990-01-01 rejected everywhere).
 * (17-6) assertCutoffPair validates cutoffDate itself instead of casting it.
 */
import { describe, it, expect, vi } from 'vitest';
import { useTimerClock } from '../../../testDir/waitPolicy.js';
import {
  ARCHIVE_CUTOFF_FUTURE_TOLERANCE_MS,
  assertCutoffPair,
  cutoffMsFromLocalDate,
} from '../archiveGuards.js';
import { DAY_MS, formatLocalDateString } from '../localDate.js';

describe('ARCHIVE_CUTOFF_FUTURE_TOLERANCE_MS (PBI 2026-11-08-16 item 5)', () => {
  it('is two days over the shared day unit', () => {
    expect(ARCHIVE_CUTOFF_FUTURE_TOLERANCE_MS).toBe(2 * DAY_MS);
  });

  it('accepts a cutoff one day out and rejects one three days out', () => {
    useTimerClock();
    try {
      const now = new Date('2026-06-15T12:00:00.000Z').getTime();
      vi.setSystemTime(now);
      const nearStr = formatLocalDateString(now + DAY_MS);
      const farStr = formatLocalDateString(now + 3 * DAY_MS);
      expect(() => cutoffMsFromLocalDate(nearStr)).not.toThrow();
      expect(() => cutoffMsFromLocalDate(farStr)).toThrow(/out of range/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('UTC lower bound and cutoffDate validation (PBI 2026-11-08-17 items 5, 6)', () => {
  it('accepts 2000-01-01 (above the UTC bound in every timezone)', () => {
    expect(() => cutoffMsFromLocalDate('2000-01-01')).not.toThrow();
  });

  it('rejects a clearly pre-2000 date in every timezone', () => {
    expect(() => cutoffMsFromLocalDate('1990-01-01')).toThrow(/out of range/);
  });

  it('rejects a non-string cutoffDate at the seam with the derivation wording', () => {
    expect(() => assertCutoffPair(20260615, 0)).toThrow(/Invalid archive cutoff date/);
    expect(() => assertCutoffPair(null, 0)).toThrow(/Invalid archive cutoff date/);
    expect(() => assertCutoffPair(undefined, 0)).toThrow(/Invalid archive cutoff date/);
  });

  it('keeps the forged-pair mismatch error', () => {
    const dateStr = '2026-06-01';
    const derived = cutoffMsFromLocalDate(dateStr);
    expect(() => assertCutoffPair(dateStr, derived + 1)).toThrow(/does not match/);
    expect(assertCutoffPair(dateStr, derived)).toBe(derived);
  });
});
