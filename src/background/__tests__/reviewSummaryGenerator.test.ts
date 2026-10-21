import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTimerClock } from '../../../testDir/waitPolicy.js';
import {
  getISOWeekNumber,
  getISOWeekYear,
  getWeekPeriod,
  getMonthPeriod,
  generateStatsSection,
  generateReviewMarkdown
} from '../reviewSummaryGenerator.js';
import type { BrowsingLogRecord } from '../../utils/sqlite-types.js';

type ReviewLogEntry = BrowsingLogRecord & { id: number };

function makeEntry(overrides: Partial<ReviewLogEntry> = {}): ReviewLogEntry {
  return {
    id: 1,
    url: 'https://example.com/article',
    title: 'Example Article',
    summary: 'This is a summary.',
    tags: '#example',
    created_at: Date.now(),
    domain: 'example.com',
    visit_duration: 30000,
    scroll_ratio: 0.8,
    is_starred: 0,
    ...overrides
  };
}

describe('reviewSummaryGenerator', () => {
  describe('getISOWeekNumber', () => {
    it('2026-01-05 is ISO week 2', () => {
      expect(getISOWeekNumber(new Date('2026-01-05'))).toBe(2);
    });

    it('2026-07-06 is ISO week 28', () => {
      expect(getISOWeekNumber(new Date('2026-07-06'))).toBe(28);
    });

    it('returns a number between 1 and 53', () => {
      const n = getISOWeekNumber(new Date('2026-06-15'));
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(53);
    });
  });

  describe('getISOWeekYear', () => {
    it('returns the previous ISO week year for a date before the first Thursday', () => {
      expect(getISOWeekYear(new Date('2025-12-29'))).toBe(2026);
    });

    it('returns the calendar year for mid-year dates', () => {
      expect(getISOWeekYear(new Date('2026-07-06'))).toBe(2026);
    });
  });

  describe('getWeekPeriod', () => {
    it('returns Monday 00:00 to Sunday 23:59:59.999 for a given date', () => {
      const { start, end } = getWeekPeriod(new Date('2026-07-08')); // Wednesday
      const startDate = new Date(start);
      const endDate = new Date(end);

      expect(startDate.getDay()).toBe(1); // Monday
      expect(startDate.getHours()).toBe(0);
      expect(startDate.getMinutes()).toBe(0);

      expect(endDate.getDay()).toBe(0); // Sunday
      expect(endDate.getHours()).toBe(23);
      expect(endDate.getMinutes()).toBe(59);
      expect(endDate.getSeconds()).toBe(59);
    });
  });

  describe('getMonthPeriod', () => {
    it('returns 1st 00:00 to last-day 23:59:59.999 for a given date', () => {
      const { start, end } = getMonthPeriod(new Date('2026-07-15'));
      const startDate = new Date(start);
      const endDate = new Date(end);

      expect(startDate.getDate()).toBe(1);
      expect(startDate.getHours()).toBe(0);

      expect(endDate.getMonth()).toBe(6); // July
      expect(endDate.getDate()).toBe(31);
      expect(endDate.getHours()).toBe(23);
      expect(endDate.getMinutes()).toBe(59);
    });
  });

  describe('generateStatsSection', () => {
    it('returns no-entry message for empty entries', () => {
      const stats = generateStatsSection([]);
      expect(stats).toContain('No entries in this period');
    });

    it('includes total entries and average visit duration', () => {
      const entries = [
        makeEntry({ visit_duration: 10000 }),
        makeEntry({ visit_duration: 20000 })
      ];
      const stats = generateStatsSection(entries);
      expect(stats).toContain('**Total entries:** 2');
      expect(stats).toContain('**Average visit duration:** 15.0s');
    });

    it('lists top domains', () => {
      const entries = [
        makeEntry({ domain: 'example.com' }),
        makeEntry({ domain: 'example.com' }),
        makeEntry({ domain: 'other.com' })
      ];
      const stats = generateStatsSection(entries);
      expect(stats).toContain('example.com: 2 entries');
      expect(stats).toContain('other.com: 1 entries');
    });
  });

  describe('generateReviewMarkdown', () => {
    it('includes period label, digest and entries', () => {
      const entries = [makeEntry({ title: 'Test Article', summary: 'Summary text' })];
      const markdown = generateReviewMarkdown('Week 28 (2026)', entries, 'Digest text');

      expect(markdown).toContain('# Yasumaro Review: Week 28 (2026)');
      expect(markdown).toContain('## Digest');
      expect(markdown).toContain('Digest text');
      expect(markdown).toContain('## Statistics');
      expect(markdown).toContain('## Entries');
      expect(markdown).toContain('Test Article');
      expect(markdown).toContain('Summary text');
    });

    it('handles empty entries gracefully', () => {
      const markdown = generateReviewMarkdown('Week 28 (2026)', [], 'No digest');
      expect(markdown).toContain('No entries in this period.');
    });
  });

  /**
   * PBI 2026-10-21-09: date output pins for the review summary Markdown.
   * The clock is faked with a fixture built from local date components, so
   * both pins hold in any timezone (localDate.test.ts pattern). The global
   * chrome mock exposes getUILanguage -> 'en', which is what getUserLocale()
   * reads here. No fixed-time waits.
   */
  describe('generateReviewMarkdown date outputs (PBI 2026-10-21-09)', () => {
    beforeEach(() => {
      useTimerClock();
      // Local 00:30 on Oct 21: the old UTC "Generated on" rendered the
      // previous day's date in positive-offset zones (JST mornings).
      vi.setSystemTime(new Date(2026, 9, 21, 0, 30, 0).getTime());
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('renders Generated on with the local date, not the UTC date', () => {
      const markdown = generateReviewMarkdown('Week 43 (2026)', [], 'No digest');
      expect(markdown).toContain('Generated on: 2026-10-21');
    });

    it('renders each entry Date with the explicit user locale, not the environment default', () => {
      const entries = [makeEntry({ created_at: new Date(2026, 9, 21, 0, 15, 0).getTime() })];
      const markdown = generateReviewMarkdown('Week 43 (2026)', entries, 'No digest');
      // The locale is the explicit getUserLocale() ('en' from the global chrome
      // mock), so the fixed-format pin is the CLDR en default date for the
      // entry's own local day — not a mirror call.
      expect(markdown).toContain('**Date:** 10/21/2026');
    });
  });
});
