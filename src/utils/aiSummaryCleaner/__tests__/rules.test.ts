// @vitest-environment jsdom
/**
 * rules.test.ts
 *
 * Locks the invariants that the rule table exists to guarantee. Before the
 * table, the rule list was written out in seven places and the copies had
 * drifted: the count path ignored 15 of the 32 rules (including two that
 * default to ON), six counted rules could never become a reason, and the
 * label map covered only 6.
 *
 * These tests fail if any layer falls out of step with the table.
 */
import { describe, it, expect } from 'vitest';
import { CLEANSING_RULES, CLEANSING_RULE_KEYS, isRuleEnabled, resolveThresholds, THRESHOLD_DEFAULTS } from '../rules.js';
import { cleanseAISummaryContent, countAISummaryTargets } from '../index.js';
import { buildRuleLabelMap, ruleMessageKey, ruleLabelFallback } from '../ruleLabels.js';
import type { AiSummaryCleanseOptions } from '../types.js';

/** A page with something for many different rule families to match. */
function makePage(): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = `
    <nav class="global-nav"><a href="/a">A</a><a href="/b">B</a></nav>
    <div class="ad-banner" data-ad-slot="top"><img alt="ad" src="x.png"></div>
    <aside class="recommend-item"><h3>おすすめ</h3></aside>
    <div class="share-buttons social-share"><a href="#">share</a></div>
    <div class="popup-overlay modal"></div>
    <div class="pagination"><a href="?p=1">1</a></div>
    <script type="application/ld+json">{"@type":"Article"}</script>
    <div class="author-meta">執筆者: テスト</div>
    <div hidden aria-hidden="true">非表示</div>
    <p>これは本文の段落です。十分な長さの日本語テキストを含みます。</p>
  `;
  return root;
}

describe('CLEANSING_RULES — table integrity', () => {
  it('defines exactly 32 rules', () => {
    expect(CLEANSING_RULES).toHaveLength(32);
  });

  it('has no duplicate keys', () => {
    expect(new Set(CLEANSING_RULE_KEYS).size).toBe(CLEANSING_RULE_KEYS.length);
  });

  it('gives every rule a callable strip', () => {
    for (const rule of CLEANSING_RULES) {
      expect(typeof rule.strip, `${rule.key}.strip`).toBe('function');
    }
  });

  it('keeps the six rules that default to ON', () => {
    // These defaults are user-visible: they decide what a stock install strips.
    const onByDefault = CLEANSING_RULES.filter(r => r.defaultEnabled).map(r => r.key);
    expect(onByDefault.sort()).toEqual(
      ['ads', 'alt', 'metadata', 'nav', 'popup', 'recommend', 'social'].sort(),
    );
  });
});

describe('isRuleEnabled', () => {
  it('honours an explicit option over the rule default', () => {
    const recommend = CLEANSING_RULES.find(r => r.key === 'recommend')!;
    expect(isRuleEnabled(recommend, {})).toBe(true);
    expect(isRuleEnabled(recommend, { recommendEnabled: false })).toBe(false);

    const deep = CLEANSING_RULES.find(r => r.key === 'deep')!;
    expect(isRuleEnabled(deep, {})).toBe(false);
    expect(isRuleEnabled(deep, { deepEnabled: true })).toBe(true);
  });
});

describe('resolveThresholds', () => {
  it('falls back to defaults and honours overrides', () => {
    expect(resolveThresholds({})).toEqual(THRESHOLD_DEFAULTS);
    expect(resolveThresholds({ linkRatioThreshold: 42 }).linkRatioThreshold).toBe(42);
    expect(resolveThresholds({ customPatterns: ['x'] }).customPatterns).toEqual(['x']);
  });
});

describe('count and cleanse agree', () => {
  // The core regression: the previous count path was a second implementation
  // and disagreed with the strips it mirrored (25 vs 14 on identical input).
  const optionSets: Array<[string, AiSummaryCleanseOptions]> = [
    ['defaults', {}],
    ['all rules on', Object.fromEntries(CLEANSING_RULE_KEYS.map(k => [`${k}Enabled`, true]))],
    ['all rules off', Object.fromEntries(CLEANSING_RULE_KEYS.map(k => [`${k}Enabled`, false]))],
    ['ads only', Object.fromEntries(CLEANSING_RULE_KEYS.map(k => [`${k}Enabled`, k === 'ads']))],
    ['body protection off', { bodyProtectionEnabled: false }],
  ];

  for (const [label, options] of optionSets) {
    it(`produces the same totals for "${label}"`, () => {
      const counted = countAISummaryTargets(makePage(), options);
      const cleansed = cleanseAISummaryContent(makePage(), options);

      expect(counted.totalRemoved).toBe(cleansed.totalRemoved);
      expect(counted.removed).toEqual(cleansed.removed);
    });
  }

  it('counts without mutating the caller DOM', () => {
    const page = makePage();
    const before = page.innerHTML;
    const result = countAISummaryTargets(page, { adsEnabled: true });

    expect(page.innerHTML).toBe(before);
    expect(result.totalRemoved).toBeGreaterThan(0);
  });
});

describe('every rule is represented end to end', () => {
  it('records a count for all 32 rules, run or not', () => {
    // "Did not run" must still be present as 0 — a missing key would surface
    // as `undefined` and break the arithmetic callers do on these fields.
    const result = cleanseAISummaryContent(makePage(), {});
    for (const key of CLEANSING_RULE_KEYS) {
      expect(result.removed[key], `removed.${key}`).toBeTypeOf('number');
    }
    expect(Object.keys(result.removed).sort()).toEqual([...CLEANSING_RULE_KEYS].sort());
  });

  it('exposes the flat xRemoved projection for every rule', () => {
    const result = cleanseAISummaryContent(makePage(), {}) as unknown as Record<string, unknown>;
    for (const key of CLEANSING_RULE_KEYS) {
      expect(result[`${key}Removed`], `${key}Removed`).toBeTypeOf('number');
    }
  });

  it('totalRemoved equals the sum of the map', () => {
    const result = cleanseAISummaryContent(makePage(), {
      ...Object.fromEntries(CLEANSING_RULE_KEYS.map(k => [`${k}Enabled`, true])),
    });
    const sum = Object.values(result.removed).reduce((a, b) => a + b, 0);
    expect(result.totalRemoved).toBe(sum);
  });

  it('counts the rules that default to ON — the original under-report', () => {
    // recommend and popup default to true but were among the 15 rules the old
    // count path dropped, so every stock install under-reported.
    const page = makePage();
    const counted = countAISummaryTargets(page, {});

    expect(counted.removed.recommend).toBeGreaterThan(0);
    expect(counted.removed.popup).toBeGreaterThan(0);
  });
});

describe('rule labels', () => {
  it('derives the i18n key from the rule key', () => {
    expect(ruleMessageKey('alt')).toBe('historyAiSummaryCleansedReasonAlt');
    expect(ruleMessageKey('newsMedia')).toBe('historyAiSummaryCleansedReasonNewsMedia');
  });

  it('provides a non-English fallback for every rule', () => {
    for (const key of CLEANSING_RULE_KEYS) {
      const fallback = ruleLabelFallback(key);
      expect(fallback, `${key} fallback`).not.toBe(key);
      expect(fallback.length).toBeGreaterThan(0);
    }
  });

  it('builds a label for every rule, never leaking a raw key', () => {
    // Simulates i18n being unavailable, which is when the old 6-entry map
    // leaked keys like "popup" into the Japanese UI.
    const map = buildRuleLabelMap(() => '');
    expect(Object.keys(map).sort()).toEqual([...CLEANSING_RULE_KEYS].sort());
    for (const key of CLEANSING_RULE_KEYS) {
      expect(map[key], `label for ${key}`).toBe(ruleLabelFallback(key));
    }
  });

  it('prefers the i18n message when present', () => {
    const map = buildRuleLabelMap(k => `msg:${k}`);
    expect(map.ads).toBe('msg:historyAiSummaryCleansedReasonAds');
  });
});
