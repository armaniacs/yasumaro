// @vitest-environment jsdom
/**
 * cleansedReason.test.ts
 *
 * The reason derivation used to be two hand-unrolled `if` chains that had
 * drifted: one listed 6 rules, the other 26, against a rule set of 32.
 * Fifteen of the 26 could never fire, and six counted rules had no branch at
 * all. These tests lock the derived behaviour so the drift cannot return.
 */
import { describe, it, expect } from 'vitest';
import { deriveCleansedReason } from '../cleansedReason.js';
import { CLEANSING_RULE_KEYS } from '../../aiSummaryCleaner/index.js';
import type { AiSummaryCleanseResult } from '../../aiSummaryCleaner/index.js';

/** Builds a result whose named rules removed one element each. */
function resultWith(removedKeys: string[]): AiSummaryCleanseResult {
  const removed: Record<string, number> = {};
  for (const key of CLEANSING_RULE_KEYS) {
    removed[key] = removedKeys.includes(key) ? 1 : 0;
  }
  return {
    removed,
    totalRemoved: removedKeys.length,
    bytesBefore: 100,
    bytesAfter: 90,
  } as unknown as AiSummaryCleanseResult;
}

describe('deriveCleansedReason', () => {
  it('returns none when nothing was removed', () => {
    expect(deriveCleansedReason(resultWith([]))).toEqual({ reason: 'none', reasons: [] });
  });

  it('returns the single rule key when exactly one rule fired', () => {
    expect(deriveCleansedReason(resultWith(['ads']))).toEqual({ reason: 'ads', reasons: [] });
  });

  it('returns multiple with the full list when several fired', () => {
    const derived = deriveCleansedReason(resultWith(['ads', 'nav']));
    expect(derived.reason).toBe('multiple');
    expect(derived.reasons.sort()).toEqual(['ads', 'nav']);
  });

  it('can report every one of the 32 rules as a reason', () => {
    // The old 6-branch version could name only alt/metadata/ads/nav/social/deep.
    for (const key of CLEANSING_RULE_KEYS) {
      expect(deriveCleansedReason(resultWith([key])).reason, `reason for ${key}`).toBe(key);
    }
  });

  it('reports the six rules that were counted but could never be a reason', () => {
    // affiliate/ecSite/newsMedia/qaSite/speechBubble/videoSite were counted by
    // the old count path but had no branch in the reason chain.
    for (const key of ['affiliate', 'ecSite', 'newsMedia', 'qaSite', 'speechBubble', 'videoSite']) {
      expect(deriveCleansedReason(resultWith([key])).reason, `reason for ${key}`).toBe(key);
    }
  });

  it('reports rules the old count path dropped entirely', () => {
    // These 15 were passed to the counter and silently discarded, so their
    // `if` branches were dead code.
    for (const key of ['fixed', 'recommend', 'popup', 'textDensity', 'shortSeq', 'author']) {
      expect(deriveCleansedReason(resultWith([key])).reason, `reason for ${key}`).toBe(key);
    }
  });

  it('ignores rules that ran but removed nothing', () => {
    const removed = Object.fromEntries(CLEANSING_RULE_KEYS.map(k => [k, 0]));
    removed.ads = 3;
    const result = { removed, totalRemoved: 3, bytesBefore: 10, bytesAfter: 5 } as unknown as AiSummaryCleanseResult;

    expect(deriveCleansedReason(result)).toEqual({ reason: 'ads', reasons: [] });
  });

  it('tolerates a result without a removal map', () => {
    const legacy = { totalRemoved: 5, bytesBefore: 10, bytesAfter: 5 } as unknown as AiSummaryCleanseResult;
    expect(deriveCleansedReason(legacy)).toEqual({ reason: 'none', reasons: [] });
  });
});
