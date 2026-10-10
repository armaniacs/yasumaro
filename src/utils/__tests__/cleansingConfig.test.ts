/**
 * cleansingConfig.test.ts — NN07 golden pin.
 *
 * Pins the derived flag property names `aiSummaryCleansing${Capitalize<key>}`
 * for every CLEANSING_RULES row, so the refactor that folds the three
 * duplicated derivations into a single `cleansingFlagProp(rule)` helper is
 * proven behavior-preserving: the derived props must stay byte-identical.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleansingFlagProp, DEFAULT_CLEANSING_CONFIG } from '../cleansingConfig.js';
import { CLEANSING_RULES } from '../aiSummaryCleaner/rules.js';
import type { RuleKey } from '../aiSummaryCleaner/types.js';

/** Byte-exact expected prop names for every rule key (golden pin). */
const GOLDEN_FLAG_PROPS: Record<RuleKey, string> = {
  alt: 'aiSummaryCleansingAlt',
  metadata: 'aiSummaryCleansingMetadata',
  ads: 'aiSummaryCleansingAds',
  nav: 'aiSummaryCleansingNav',
  social: 'aiSummaryCleansingSocial',
  deep: 'aiSummaryCleansingDeep',
  jsonLd: 'aiSummaryCleansingJsonLd',
  lazyLoad: 'aiSummaryCleansingLazyLoad',
  skipLink: 'aiSummaryCleansingSkipLink',
  card: 'aiSummaryCleansingCard',
  linkDensity: 'aiSummaryCleansingLinkDensity',
  fixed: 'aiSummaryCleansingFixed',
  recommend: 'aiSummaryCleansingRecommend',
  pagination: 'aiSummaryCleansingPagination',
  snsPromo: 'aiSummaryCleansingSnsPromo',
  popup: 'aiSummaryCleansingPopup',
  cookie: 'aiSummaryCleansingCookie',
  platform: 'aiSummaryCleansingPlatform',
  textDensity: 'aiSummaryCleansingTextDensity',
  shortSeq: 'aiSummaryCleansingShortSeq',
  symbolLine: 'aiSummaryCleansingSymbolLine',
  linkPara: 'aiSummaryCleansingLinkPara',
  enhancedHidden: 'aiSummaryCleansingEnhancedHidden',
  emptyElem: 'aiSummaryCleansingEmptyElem',
  jpLayout: 'aiSummaryCleansingJpLayout',
  jpNavigation: 'aiSummaryCleansingJpNavigation',
  author: 'aiSummaryCleansingAuthor',
  affiliate: 'aiSummaryCleansingAffiliate',
  speechBubble: 'aiSummaryCleansingSpeechBubble',
  newsMedia: 'aiSummaryCleansingNewsMedia',
  ecSite: 'aiSummaryCleansingEcSite',
  qaSite: 'aiSummaryCleansingQaSite',
  videoSite: 'aiSummaryCleansingVideoSite',
};

describe('cleansingFlagProp golden pin (NN07)', () => {
  it('golden map covers exactly the CLEANSING_RULES key space', () => {
    const goldenKeys = new Set(Object.keys(GOLDEN_FLAG_PROPS));
    const ruleKeys = new Set(CLEANSING_RULES.map((r) => r.key as string));
    for (const k of ruleKeys) {
      expect(goldenKeys.has(k)).toBe(true);
    }
    for (const k of goldenKeys) {
      expect(ruleKeys.has(k)).toBe(true);
    }
  });

  it('derives the pinned aiSummaryCleansing<Capitalized> prop for every rule', () => {
    for (const rule of CLEANSING_RULES) {
      expect(cleansingFlagProp(rule)).toBe(GOLDEN_FLAG_PROPS[rule.key]);
    }
  });

  it('placeholder defaults are keyed by the same derived props', () => {
    for (const rule of CLEANSING_RULES) {
      expect(DEFAULT_CLEANSING_CONFIG[cleansingFlagProp(rule)]).toBe(rule.defaultEnabled);
    }
  });
});

describe('cleansingFlagProp is the single runtime derivation (NN07)', () => {
  const readSource = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8');

  it('call sites call the shared helper instead of inlining the derivation', () => {
    const optionBuilder = readSource('src/utils/contentExtractor/optionBuilder.ts');
    const visitGating = readSource('src/content/visitGating.ts');
    expect(optionBuilder).toContain('cleansingFlagProp(');
    expect(visitGating).toContain('cleansingFlagProp(');
    expect(optionBuilder).not.toMatch(/charAt\(0\)\.toUpperCase\(\)/);
    expect(visitGating).not.toMatch(/charAt\(0\)\.toUpperCase\(\)/);
  });
});
