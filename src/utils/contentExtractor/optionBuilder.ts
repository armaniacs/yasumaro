/**
 * optionBuilder.ts
 * Extracted from extractor.ts (PBI-02).
 * Shared option builder that converts CleansingConfig into the option objects
 * consumed by extractMainContent(). Eliminates the 32-field duplication between
 * extractor.ts and contentExtractor/index.ts.
 */

import type { CleanseOptions } from '../contentCleaner.js';
import type { AiSummaryCleanseOptions } from '../aiSummaryCleaner/index.js';
import { CLEANSING_RULES } from '../aiSummaryCleaner/rules.js';
import { cleansingFlagProp } from '../cleansingConfig.js';
import type { CleansingConfig } from '../cleansingConfig.js';

interface ExtractionOptions {
    cleanseOptions: CleanseOptions & { cleanseEnabled: boolean; whitelistExtractionEnabled: boolean };
    aiSummaryCleanseOptions: AiSummaryCleanseOptions & { aiSummaryCleanseEnabled: boolean };
    dedupOptions: { dedupEnabled: boolean; dedupThreshold: number };
}

/**
 * Build the option objects for extractMainContent() from a CleansingConfig.
 * Single source of truth for the CleansingConfig → extractMainContent mapping.
 */
export function buildExtractionOptions(config: CleansingConfig): ExtractionOptions {
    const cleanseOptions = {
        cleanseEnabled: config.contentStripHardEnabled || config.contentStripKeywordEnabled,
        hardStripEnabled: config.contentStripHardEnabled,
        keywordStripEnabled: config.contentStripKeywordEnabled,
        keywords: config.contentStripKeywords,
        whitelistExtractionEnabled: config.whitelistExtractionEnabled,
    };

    // Derive the 32 rule flags from CLEANSING_RULES instead of listing each
    // mapping by hand. Each rule `key` maps:
    //   config[cleansingFlagProp(rule)] → options[`${rule.key}Enabled`]
    const ruleFlags: Record<string, boolean> = Object.fromEntries(
        CLEANSING_RULES.map(rule => [
            `${rule.key}Enabled`,
            config[cleansingFlagProp(rule)],
        ]),
    );

    const aiSummaryCleanseOptions: AiSummaryCleanseOptions & { aiSummaryCleanseEnabled: boolean } = {
        aiSummaryCleanseEnabled: config.aiSummaryCleansingEnabled,
        ...ruleFlags,
        linkRatioThreshold: config.aiSummaryCleansingLinkRatioThreshold,
        shortTextThreshold: config.aiSummaryCleansingShortTextThreshold,
        shortSeqCount: config.aiSummaryCleansingShortSeqCount,
        linkParaThreshold: config.aiSummaryCleansingLinkParaThreshold,
        customPatterns: config.aiSummaryCleansingCustomPatterns,
        // Over-cleansed fallback thresholds
        fallbackRatio: config.aiSummaryCleansingFallbackRatio,
        fallbackMinBytes: config.aiSummaryCleansingFallbackMinBytes,
        // PBI 05 overcut guards
        fallbackMinChars: config.aiSummaryCleansingFallbackMinChars,
        candidateGuardEnabled: config.candidateGuardEnabled,
        cleanseGuardEnabled: config.cleanseGuardEnabled,
    };

    const dedupOptions = {
        dedupEnabled: config.contentDedupEnabled,
        dedupThreshold: config.contentDedupThreshold,
    };

    return { cleanseOptions, aiSummaryCleanseOptions, dedupOptions };
}
