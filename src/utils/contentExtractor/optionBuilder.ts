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
import type { CleansingConfig } from '../../content/pageState.js';

interface ExtractionOptions {
    cleanseOptions: CleanseOptions & { cleanseEnabled: boolean; returnInfo: true; whitelistExtractionEnabled: boolean };
    aiSummaryCleanseOptions: AiSummaryCleanseOptions & { aiSummaryCleanseEnabled: boolean };
    dedupOptions: { dedupEnabled: boolean; dedupThreshold: number };
}

/** Capitalize the first character for the CleansingConfig property name. */
function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
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
        returnInfo: true as const,
        whitelistExtractionEnabled: config.whitelistExtractionEnabled,
    };

    // Derive the 32 rule flags from CLEANSING_RULES instead of listing each
    // mapping by hand. Each rule `key` maps:
    //   config[`aiSummaryCleansing${Capitalize<key>}`] → options[`${key}Enabled`]
    const ruleFlags: Record<string, boolean> = Object.fromEntries(
        CLEANSING_RULES.map(rule => [
            `${rule.key}Enabled`,
            (config as unknown as Record<string, unknown>)[`aiSummaryCleansing${capitalize(rule.key)}`] as boolean,
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
    };

    const dedupOptions = {
        dedupEnabled: config.contentDedupEnabled,
        dedupThreshold: config.contentDedupThreshold,
    };

    return { cleanseOptions, aiSummaryCleanseOptions, dedupOptions };
}
