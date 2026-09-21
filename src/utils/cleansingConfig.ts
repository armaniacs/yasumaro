/**
 * cleansingConfig.ts
 * Owner of the CleansingConfig type and its default construction.
 *
 * Design decision (PBI 2026-09-21-16, design-it-twice):
 *   Option A (taken): move the type + defaults here, into src/utils/.
 *   Option B (rejected): relocate pageContentPipeline.ts into src/content/.
 *   A wins because this surface depends ONLY on utils tables (CLEANSING_RULES,
 *   THRESHOLD_RULES, DEFAULT_KEYWORDS — pure data, no DOM/chrome coupling, verified
 *   by grep), so it can drop one layer and fix the import direction for every
 *   utils consumer at once. B would have preserved the ambiguous default owner
 *   and forfeited content-free reuse of preparePageContent. pageState.ts keeps
 *   re-exports so existing `content/pageState.js` import paths do not break.
 */

import type { RuleKey } from './aiSummaryCleaner/types.js';
import { CLEANSING_RULES, THRESHOLD_RULES } from './aiSummaryCleaner/rules.js';
import type { ThresholdProp } from './aiSummaryCleaner/rules.js';
import { DEFAULT_KEYWORDS } from './contentCleaner.js';

// ---------------------------------------------------------------------------
// Rule-derived flags: aiSummaryCleansing${Capitalize<RuleKey>}
// ---------------------------------------------------------------------------

type CleansingConfigRuleFlags = {
    [K in RuleKey as `aiSummaryCleansing${Capitalize<K>}`]: boolean;
};

// 【クレンジング設定】: コンテンツクレンジングとAI要約クレンジングの設定を一括管理
// ThresholdProp (7 numeric thresholds) is intersected so that cfg[t.prop] is type-safe
// without unsafe casts in extractor.ts. Fixed fields exclude the 7 threshold
// props to avoid duplicate-key declarations.
export interface CleansingConfig extends CleansingConfigRuleFlags, Record<ThresholdProp, number> {
    contentStripHardEnabled: boolean;
    contentStripKeywordEnabled: boolean;
    contentStripKeywords: string[];
    aiSummaryCleansingEnabled: boolean;
    whitelistExtractionEnabled: boolean;
    aiSummaryCleansingCustomPatterns: string[];
    contentDedupEnabled: boolean;
}

/**
 * Rule-flag defaults for the placeholder config used before loadSettings()
 * resolves. init() always awaits loadSettings() before anything can read
 * cleansingConfig for a real extraction, so this only needs to match
 * `defaultEnabled` (the "no value specified yet" fallback), not the
 * new-user storage default — see pbi/2026-08-09-20.
 * Derives directly from CLEANSING_RULES (the single source of truth).
 */
const CLEANSING_RULE_PLACEHOLDER_DEFAULTS: CleansingConfigRuleFlags = Object.fromEntries(
    CLEANSING_RULES.map(rule => [
        `aiSummaryCleansing${rule.key.charAt(0).toUpperCase()}${rule.key.slice(1)}`,
        rule.defaultEnabled,
    ]),
) as CleansingConfigRuleFlags;

// Derived from the shared THRESHOLD_RULES source of truth.
export const THRESHOLD_CONFIG_DEFAULTS: Record<ThresholdProp, number> = Object.fromEntries(
    THRESHOLD_RULES.map(r => [r.prop, r.default]),
) as Record<ThresholdProp, number>;

// THRESHOLD fields derive from THRESHOLD_CONFIG_DEFAULTS, which derives from
// THRESHOLD_RULES (the single source of truth).
export const DEFAULT_CLEANSING_CONFIG: CleansingConfig = {
    contentStripHardEnabled: true,
    contentStripKeywordEnabled: true,
    contentStripKeywords: [...DEFAULT_KEYWORDS],
    aiSummaryCleansingEnabled: true,
    whitelistExtractionEnabled: true,
    aiSummaryCleansingLinkRatioThreshold: THRESHOLD_CONFIG_DEFAULTS.aiSummaryCleansingLinkRatioThreshold,
    aiSummaryCleansingShortTextThreshold: THRESHOLD_CONFIG_DEFAULTS.aiSummaryCleansingShortTextThreshold,
    aiSummaryCleansingShortSeqCount: THRESHOLD_CONFIG_DEFAULTS.aiSummaryCleansingShortSeqCount,
    aiSummaryCleansingLinkParaThreshold: THRESHOLD_CONFIG_DEFAULTS.aiSummaryCleansingLinkParaThreshold,
    aiSummaryCleansingCustomPatterns: [],
    aiSummaryCleansingFallbackRatio: THRESHOLD_CONFIG_DEFAULTS.aiSummaryCleansingFallbackRatio,
    aiSummaryCleansingFallbackMinBytes: THRESHOLD_CONFIG_DEFAULTS.aiSummaryCleansingFallbackMinBytes,
    contentDedupEnabled: true,
    contentDedupThreshold: THRESHOLD_CONFIG_DEFAULTS.contentDedupThreshold,
    ...CLEANSING_RULE_PLACEHOLDER_DEFAULTS,
};

/**
 * Fresh default config with owned array copies. Previously spelled inline as
 * `new PageState().cleansingConfig`; extracted here so the utils-layer
 * pipeline can resolve its no-arg default without reaching into src/content/.
 */
export function createDefaultCleansingConfig(): CleansingConfig {
    return {
        ...DEFAULT_CLEANSING_CONFIG,
        contentStripKeywords: [...DEFAULT_CLEANSING_CONFIG.contentStripKeywords],
        aiSummaryCleansingCustomPatterns: [...DEFAULT_CLEANSING_CONFIG.aiSummaryCleansingCustomPatterns],
    };
}
