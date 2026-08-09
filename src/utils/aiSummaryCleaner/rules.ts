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
import { StorageKeys } from '../storage/types.js';
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
 *
 * `newUserDefault` and `defaultEnabled` look redundant but are not: they
 * answer different questions and legitimately differ for the 7 rules whose
 * rollout was staged (Category A `jpLayout`, Category B `newsMedia`/`ecSite`/
 * `qaSite`/`videoSite`, plus `deep`/`linkDensity`). `migration.ts` writes
 * `false` for those keys into an *existing* user's storage so their behaviour
 * does not change on update, while a *fresh install* gets `newUserDefault`
 * from DEFAULT_SETTINGS. `defaultEnabled` is the value used only when a
 * caller — a test, or countAISummaryTargets — omits the flag entirely; that
 * has no relationship to whether the user is new or existing, so it is not
 * safe to collapse the two into one field.
 */
export interface CleansingRule {
    /** Stable identifier. Drives option name, result key, reason and label. */
    key: string;
    /** Value used when a caller (a test, countAISummaryTargets) omits the flag. */
    defaultEnabled: boolean;
    /** chrome.storage key. Must match the value already in StorageKeys. */
    storageKey: string;
    /** DEFAULT_SETTINGS value for a fresh install (storage empty). */
    newUserDefault: boolean;
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
    { key: 'alt', defaultEnabled: true, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_ALT, newUserDefault: true, strip: (el) => stripAltAttributes(el) },
    { key: 'metadata', defaultEnabled: true, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_METADATA, newUserDefault: true, strip: (el) => stripMetadataElements(el) },
    { key: 'ads', defaultEnabled: true, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_ADS, newUserDefault: true, strip: (el) => stripAdElements(el) },
    // nav folds in legal text nodes: both are "site chrome", and they were
    // summed into a single counter before this table existed.
    { key: 'nav', defaultEnabled: true, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_NAV, newUserDefault: true, strip: (el) => stripNavElements(el) + stripLegalTextNodes(el) },
    { key: 'social', defaultEnabled: true, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_SOCIAL, newUserDefault: true, strip: (el) => stripSocialElements(el) },
    // newUserDefault:true has no migration pinning existing users to false
    // (unlike jpLayout/newsMedia below) — see pbi/2026-08-09-20 "落とし穴".
    { key: 'deep', defaultEnabled: false, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_DEEP, newUserDefault: true, strip: (el) => stripDeepElements(el) },
    { key: 'jsonLd', defaultEnabled: false, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_JSON_LD, newUserDefault: false, strip: (el) => stripJsonLdScripts(el) },
    { key: 'lazyLoad', defaultEnabled: false, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_LAZY_LOAD, newUserDefault: false, strip: (el) => stripLazyLoadElements(el) },
    { key: 'skipLink', defaultEnabled: false, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_SKIP_LINK, newUserDefault: false, strip: (el) => stripSkipLinks(el) },
    { key: 'card', defaultEnabled: false, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_CARD, newUserDefault: false, strip: (el) => stripCardElements(el) },
    // Same staged-rollout shape as deep: no migration exists for this key.
    { key: 'linkDensity', defaultEnabled: false, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_LINK_DENSITY, newUserDefault: true, strip: (el) => stripHighLinkDensityElements(el) },
    { key: 'fixed', defaultEnabled: false, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_FIXED, newUserDefault: false, strip: (el) => stripFixedElements(el) },
    { key: 'recommend', defaultEnabled: true, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_RECOMMEND, newUserDefault: true, strip: (el) => stripRecommendSections(el) },
    { key: 'pagination', defaultEnabled: false, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_PAGINATION, newUserDefault: false, strip: (el) => stripPaginationElements(el) },
    { key: 'snsPromo', defaultEnabled: false, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_SNS_PROMO, newUserDefault: false, strip: (el) => stripSnsPromoElements(el) },
    { key: 'popup', defaultEnabled: true, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_POPUP, newUserDefault: true, strip: (el) => stripPopupElements(el) },
    { key: 'platform', defaultEnabled: false, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_PLATFORM, newUserDefault: false, strip: (el) => stripPlatformNoise(el) },
    { key: 'textDensity', defaultEnabled: false, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_TEXT_DENSITY, newUserDefault: false, strip: (el, t) => stripTextDensityElements(el, t.linkRatioThreshold) },
    { key: 'shortSeq', defaultEnabled: false, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_SHORT_SEQ, newUserDefault: false, strip: (el, t) => stripShortSequenceElements(el, t.shortTextThreshold, t.shortSeqCount) },
    { key: 'symbolLine', defaultEnabled: false, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_SYMBOL_LINE, newUserDefault: false, strip: (el) => stripSymbolLineElements(el) },
    { key: 'linkPara', defaultEnabled: false, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_LINK_PARA, newUserDefault: false, strip: (el, t) => stripLinkOnlyParagraphs(el, t.linkParaThreshold) },
    { key: 'enhancedHidden', defaultEnabled: false, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_ENHANCED_HIDDEN, newUserDefault: false, strip: (el) => stripEnhancedHiddenElements(el) },
    { key: 'emptyElem', defaultEnabled: false, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_EMPTY_ELEM, newUserDefault: false, strip: (el) => stripEmptyElements(el) },
    // Category A: migrateJpLayoutDefault() pins existing users to false so
    // this staged true only reaches fresh installs.
    { key: 'jpLayout', defaultEnabled: false, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_JP_LAYOUT, newUserDefault: true, strip: (el, t) => stripJPLayoutPatterns(el, t.customPatterns) },
    { key: 'jpNavigation', defaultEnabled: false, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_JP_NAVIGATION, newUserDefault: false, strip: (el) => stripJPNavigationPatterns(el) },
    { key: 'author', defaultEnabled: false, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_AUTHOR, newUserDefault: false, strip: (el) => stripAuthorMetaElements(el) },
    { key: 'affiliate', defaultEnabled: false, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_AFFILIATE, newUserDefault: false, strip: (el) => stripAffiliateElements(el) },
    { key: 'speechBubble', defaultEnabled: false, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_SPEECH_BUBBLE, newUserDefault: false, strip: (el) => stripSpeechBubbles(el) },
    // Category B: migrateCategoryBDefault() pins existing users to false so
    // this staged true only reaches fresh installs (all 4 below).
    { key: 'newsMedia', defaultEnabled: false, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_NEWS_MEDIA, newUserDefault: true, strip: (el) => stripNewsMediaPatterns(el) },
    { key: 'ecSite', defaultEnabled: false, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_EC_SITE, newUserDefault: true, strip: (el) => stripEcSitePatterns(el) },
    { key: 'qaSite', defaultEnabled: false, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_QA_SITE, newUserDefault: true, strip: (el) => stripQaSitePatterns(el) },
    { key: 'videoSite', defaultEnabled: false, storageKey: StorageKeys.AI_SUMMARY_CLEANSING_VIDEO_SITE, newUserDefault: true, strip: (el) => stripVideoSitePatterns(el) },
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
