import { describe, it, expect } from 'vitest';
import { deriveCleansedReasonFromCounts, getCleansedBadgeText } from '../cleansingBadge.js';

describe('deriveCleansedReasonFromCounts (PBI 2026-09-11-05)', () => {
  it('hard only', () => {
    expect(deriveCleansedReasonFromCounts({ hardStripRemoved: 3, keywordStripRemoved: 0 })).toBe('hard');
  });

  it('keyword only', () => {
    expect(deriveCleansedReasonFromCounts({ hardStripRemoved: 0, keywordStripRemoved: 2 })).toBe('keyword');
  });

  it('both when both are positive', () => {
    expect(deriveCleansedReasonFromCounts({ hardStripRemoved: 1, keywordStripRemoved: 1 })).toBe('both');
  });

  it('defaults to both when neither is positive (original handler semantics)', () => {
    expect(deriveCleansedReasonFromCounts({ hardStripRemoved: 0, keywordStripRemoved: 0 })).toBe('both');
    expect(deriveCleansedReasonFromCounts({})).toBe('both');
  });
});

describe('getCleansedBadgeText (PBI 2026-09-11-05)', () => {
  const getMessage = (key: string) => `i18n:${key}`;

  it('maps each reason to its i18n key', () => {
    expect(getCleansedBadgeText('hard', getMessage)).toBe('i18n:cleansedBadgeHard');
    expect(getCleansedBadgeText('keyword', getMessage)).toBe('i18n:cleansedBadgeKeyword');
    expect(getCleansedBadgeText('both', getMessage)).toBe('i18n:cleansedBadgeBoth');
  });

  it('falls back to the literal when the resolver returns empty (test DOMs)', () => {
    expect(getCleansedBadgeText('hard', () => '')).toBe('🧹 Hard');
  });

  it('returns empty for none / undefined', () => {
    expect(getCleansedBadgeText('none', getMessage)).toBe('');
    expect(getCleansedBadgeText(undefined, getMessage)).toBe('');
  });
});
