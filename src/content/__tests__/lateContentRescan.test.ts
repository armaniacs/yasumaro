// @vitest-environment jsdom
/**
 * lateContentRescan.test.ts
 * PBI 2026-10-22-06 slice 2 (SPA late-content re-scan): pins the pure
 * re-arm verdict table and the fail-closed DOM read. Short pages must
 * double, long pages re-arm on one full page of growth, the cap bounds the
 * extra sends, and degenerate inputs never re-open the gate.
 */
import { describe, it, expect } from 'vitest';
import {
  LATE_RESCAN_MAX_REARMS,
  LATE_RESCAN_MIN_GROWTH_CHARS,
  shouldRearmForLateContent,
} from '../lateContentRescan.js';
import { readVisibleChars } from '../lateContentDomReader.js';

describe('shouldRearmForLateContent (SPA late-content re-scan)', () => {
  it('re-arms when a short page at least doubles', () => {
    expect(shouldRearmForLateContent(1000, 1000 + LATE_RESCAN_MIN_GROWTH_CHARS, 0)).toBe(true);
    expect(shouldRearmForLateContent(1000, 1000 + LATE_RESCAN_MIN_GROWTH_CHARS - 1, 0)).toBe(false);
  });

  it('re-arms a long page only on one full page of growth', () => {
    expect(shouldRearmForLateContent(8000, 16000, 0)).toBe(true);
    expect(shouldRearmForLateContent(8000, 15999, 0)).toBe(false);
    // The absolute floor never waives the doubling rule on long pages.
    expect(shouldRearmForLateContent(8000, 8000 + LATE_RESCAN_MIN_GROWTH_CHARS, 0)).toBe(false);
  });

  it('bounds re-arms per page view', () => {
    expect(shouldRearmForLateContent(1000, 5000, LATE_RESCAN_MAX_REARMS - 1)).toBe(true);
    expect(shouldRearmForLateContent(1000, 5000, LATE_RESCAN_MAX_REARMS)).toBe(false);
    expect(shouldRearmForLateContent(1000, 500000, LATE_RESCAN_MAX_REARMS)).toBe(false);
  });

  it('fails closed on degenerate input (gate stays shut)', () => {
    expect(shouldRearmForLateContent(0, 5000, 0)).toBe(false);
    expect(shouldRearmForLateContent(-10, 5000, 0)).toBe(false);
    expect(shouldRearmForLateContent(1000, 1000, 0)).toBe(false);
    expect(shouldRearmForLateContent(1000, 999, 0)).toBe(false);
    expect(shouldRearmForLateContent(Number.NaN, 5000, 0)).toBe(false);
    expect(shouldRearmForLateContent(1000, Number.POSITIVE_INFINITY, 0)).toBe(false);
    expect(shouldRearmForLateContent(1000, 5000, -1)).toBe(false);
    expect(shouldRearmForLateContent(1000, 5000, 1.5)).toBe(false);
  });
});

describe('readVisibleChars (fail-closed DOM read)', () => {
  it('reads zero on an empty body and never throws', () => {
    document.body.innerHTML = '';
    expect(readVisibleChars()).toBe(0);
  });
});
