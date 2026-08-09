/**
 * AI要約クレンジング — ルール表（単一の情報源）
 *
 * Every cleansing rule is one row here. Before this table existed the same
 * rule list was written out in seven places (options destructure, counter
 * variable, dispatch `if`, log breakdown, return object, a parallel
 * implementation in countTargets.ts, and the reason-label mapping), and the
 * copies had already drifted: the count path silently ignored 15 of the 32
 * rules — including `recommend` and `popup`, which default to ON, so every
 * user on stock settings saw an under-reported element count.
 *
 * Adding a rule is now one row. Forgetting a field is a type error.
 *
 * NOTE: counting is derived from `strip` (see `countRuleTargets` in index.ts)
 * rather than reimplemented. A hand-written counter cannot be kept in step
 * with its strip — the old pair disagreed 25 vs 14 on identical input,
 * because the two implementations used different selectors.
 */

import type { AiSummaryCleanseOptions } from './types.js';
import {
    stripAltAttributes,
    stripMetadataElements,
    stripAdElements,
    stripNavElements,
    stripLegalTextNodes,
    stripHighLinkDensityElements,
    stripSocialElements,
    stripJsonLdScripts,
    stripLazyLoadElements,
    stripSkipLinks,
    stripCardElements,
    stripDeepElements,
} from './stripCore.js';
import {
    stripFixedElements,
    stripRecommendSections,
    stripPaginationElements,
    stripSnsPromoElements,
    stripPopupElements,
    stripPlatformNoise,
    stripTextDensityElements,
    stripShortSequenceElements,
    stripSymbolLineElements,
    stripLinkOnlyParagraphs,
    stripEnhancedHiddenElements,
    stripEmptyElements,
    stripJPLayoutPatterns,
    stripJPNavigationPatterns,
    stripAuthorMetaElements,
    stripAffiliateElements,
    stripSpeechBubbles,
    stripNewsMediaPatterns,
    stripEcSitePatterns,
    stripQaSitePatterns,
    stripVideoSitePatterns,
} from './stripExtended.js';

/**
 * Resolved threshold settings handed to rules that need them.
 * These are parameters, not rules, so they are not table rows.
 */
export interface CleansingThresholds {
    linkRatioThreshold: number;
    shortTextThreshold: number;
    shortSeqCount: number;
    linkParaThreshold: number;
    customPatterns: string[];
}

export const THRESHOLD_DEFAULTS: CleansingThresholds = {
    linkRatioThreshold: 70,
    shortTextThreshold: 30,
    shortSeqCount: 5,
    linkParaThreshold: 50,
    customPatterns: [],
};

/**
 * One cleansing rule.
 *
 * `key` is the stable identifier used for the option name (`${key}Enabled`),
 * the result map key, the persisted reason value, and the i18n message key.
 * Deriving all four from one string is what keeps the layers in step.
 */
export interface CleansingRule {
    /** Stable identifier. Drives option name, result key, reason and label. */
    key: string;
    /** Whether the rule runs when the caller does not specify it. */
    defaultEnabled: boolean;
    /** Removes matching content and returns how many elements it removed. */
    strip: (element: Element, thresholds: CleansingThresholds) => number;
}

/**
 * All cleansing rules, in execution order.
 *
 * Order matters: body-protection marking happens before the first rule and
 * unmarking after the last, and some rules are cheaper once earlier ones
 * have pruned the tree. This order matches the original hand-written
 * dispatch sequence exactly.
 */
export const CLEANSING_RULES: readonly CleansingRule[] = [
    { key: 'alt', defaultEnabled: true, strip: (el) => stripAltAttributes(el) },
    { key: 'metadata', defaultEnabled: true, strip: (el) => stripMetadataElements(el) },
    { key: 'ads', defaultEnabled: true, strip: (el) => stripAdElements(el) },
    // nav folds in legal text nodes: both are "site chrome", and they were
    // summed into a single counter before this table existed.
    { key: 'nav', defaultEnabled: true, strip: (el) => stripNavElements(el) + stripLegalTextNodes(el) },
    { key: 'social', defaultEnabled: true, strip: (el) => stripSocialElements(el) },
    { key: 'deep', defaultEnabled: false, strip: (el) => stripDeepElements(el) },
    { key: 'jsonLd', defaultEnabled: false, strip: (el) => stripJsonLdScripts(el) },
    { key: 'lazyLoad', defaultEnabled: false, strip: (el) => stripLazyLoadElements(el) },
    { key: 'skipLink', defaultEnabled: false, strip: (el) => stripSkipLinks(el) },
    { key: 'card', defaultEnabled: false, strip: (el) => stripCardElements(el) },
    { key: 'linkDensity', defaultEnabled: false, strip: (el) => stripHighLinkDensityElements(el) },
    { key: 'fixed', defaultEnabled: false, strip: (el) => stripFixedElements(el) },
    { key: 'recommend', defaultEnabled: true, strip: (el) => stripRecommendSections(el) },
    { key: 'pagination', defaultEnabled: false, strip: (el) => stripPaginationElements(el) },
    { key: 'snsPromo', defaultEnabled: false, strip: (el) => stripSnsPromoElements(el) },
    { key: 'popup', defaultEnabled: true, strip: (el) => stripPopupElements(el) },
    { key: 'platform', defaultEnabled: false, strip: (el) => stripPlatformNoise(el) },
    { key: 'textDensity', defaultEnabled: false, strip: (el, t) => stripTextDensityElements(el, t.linkRatioThreshold) },
    { key: 'shortSeq', defaultEnabled: false, strip: (el, t) => stripShortSequenceElements(el, t.shortTextThreshold, t.shortSeqCount) },
    { key: 'symbolLine', defaultEnabled: false, strip: (el) => stripSymbolLineElements(el) },
    { key: 'linkPara', defaultEnabled: false, strip: (el, t) => stripLinkOnlyParagraphs(el, t.linkParaThreshold) },
    { key: 'enhancedHidden', defaultEnabled: false, strip: (el) => stripEnhancedHiddenElements(el) },
    { key: 'emptyElem', defaultEnabled: false, strip: (el) => stripEmptyElements(el) },
    { key: 'jpLayout', defaultEnabled: false, strip: (el, t) => stripJPLayoutPatterns(el, t.customPatterns) },
    { key: 'jpNavigation', defaultEnabled: false, strip: (el) => stripJPNavigationPatterns(el) },
    { key: 'author', defaultEnabled: false, strip: (el) => stripAuthorMetaElements(el) },
    { key: 'affiliate', defaultEnabled: false, strip: (el) => stripAffiliateElements(el) },
    { key: 'speechBubble', defaultEnabled: false, strip: (el) => stripSpeechBubbles(el) },
    { key: 'newsMedia', defaultEnabled: false, strip: (el) => stripNewsMediaPatterns(el) },
    { key: 'ecSite', defaultEnabled: false, strip: (el) => stripEcSitePatterns(el) },
    { key: 'qaSite', defaultEnabled: false, strip: (el) => stripQaSitePatterns(el) },
    { key: 'videoSite', defaultEnabled: false, strip: (el) => stripVideoSitePatterns(el) },
] as const;

/** Every rule key, in execution order. */
export const CLEANSING_RULE_KEYS: readonly string[] = CLEANSING_RULES.map(r => r.key);

/**
 * Resolves whether a rule should run, honouring the caller's options and
 * falling back to the rule's own default.
 */
export function isRuleEnabled(rule: CleansingRule, options: AiSummaryCleanseOptions): boolean {
    const value = (options as Record<string, unknown>)[`${rule.key}Enabled`];
    return typeof value === 'boolean' ? value : rule.defaultEnabled;
}

/** Merges caller-supplied thresholds over the defaults. */
export function resolveThresholds(options: AiSummaryCleanseOptions): CleansingThresholds {
    return {
        linkRatioThreshold: options.linkRatioThreshold ?? THRESHOLD_DEFAULTS.linkRatioThreshold,
        shortTextThreshold: options.shortTextThreshold ?? THRESHOLD_DEFAULTS.shortTextThreshold,
        shortSeqCount: options.shortSeqCount ?? THRESHOLD_DEFAULTS.shortSeqCount,
        linkParaThreshold: options.linkParaThreshold ?? THRESHOLD_DEFAULTS.linkParaThreshold,
        customPatterns: options.customPatterns ?? THRESHOLD_DEFAULTS.customPatterns,
    };
}
