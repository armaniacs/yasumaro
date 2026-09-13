import { describe, it, expect } from 'vitest';
import { deriveCleansedReasonFromCounts, getCleansedBadgeText, buildCleansingCountDetail } from '../cleansingBadge.js';

describe('deriveCleansedReasonFromCounts (PBI 2026-09-11-07: delegates to resolveCleanseReason)', () => {
  it('hard only', () => {
    expect(deriveCleansedReasonFromCounts({ hardStripRemoved: 3, keywordStripRemoved: 0 })).toBe('hard');
  });

  it('keyword only', () => {
    expect(deriveCleansedReasonFromCounts({ hardStripRemoved: 0, keywordStripRemoved: 2 })).toBe('keyword');
  });

  it('both when both are positive', () => {
    expect(deriveCleansedReasonFromCounts({ hardStripRemoved: 1, keywordStripRemoved: 1 })).toBe('both');
  });

  it("answers (0,0) with 'none' — the extractor-side semantics (PBI 2026-09-11-07)", () => {
    // The round-4 local copy answered 'both' for empty counts; the single
    // dual-axis owner resolveCleanseReason says 'none'. Callers that must not
    // show a badge check against 'none'.
    expect(deriveCleansedReasonFromCounts({ hardStripRemoved: 0, keywordStripRemoved: 0 })).toBe('none');
    expect(deriveCleansedReasonFromCounts({})).toBe('none');
  });
});

describe('buildCleansingCountDetail (PBI 2026-09-11-07: i18n count detail)', () => {
  const getMessage = (key: string, substitutions?: string | string[]) => {
    if (substitutions === undefined) return `i18n:${key}`;
    const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
    return `i18n:${key}[${subs.join(',')}]`;
  };

  it('includes only the axes that removed something', () => {
    expect(buildCleansingCountDetail({ hardStripRemoved: 3, keywordStripRemoved: 2 }, getMessage))
      .toBe('i18n:cleansingDetailHard[3], i18n:cleansingDetailKeyword[2]');
    expect(buildCleansingCountDetail({ hardStripRemoved: 3 }, getMessage))
      .toBe('i18n:cleansingDetailHard[3]');
  });

  it('falls back to the English literal when the resolver returns empty (test DOMs)', () => {
    expect(buildCleansingCountDetail({ hardStripRemoved: 1 }, () => '')).toBe('Hard: 1');
  });

  it('returns empty when nothing was removed', () => {
    expect(buildCleansingCountDetail({ hardStripRemoved: 0, keywordStripRemoved: 0 }, getMessage)).toBe('');
    expect(buildCleansingCountDetail({}, getMessage)).toBe('');
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
