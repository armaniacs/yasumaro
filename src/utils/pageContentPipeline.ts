// @layer 2 — High-level Utilities (depends on Layer 0/1)
/**
 * PageContentPipeline — deep module hiding the 10 shallow content-extraction modules
 *
 * 10 shallow modules (contentExtractor/index, optionBuilder, classifier, scoring,
 * textExtraction, whitelistAdapters, aiSummaryCleaner/index, stripCore,
 * stripExtended, helpers/patterns/rules) are composed behind one seam.
 *
 * Interface is the test surface: callers and tests cross the same seam.
 * Internal helpers are private seams, not part of the public interface.
 * Deletion test: deleting this module would scatter the 6-step orchestration
 * (buildExtractionOptions → whitelist check → scoring → text extraction →
 * contentCleaner → aiSummaryCleaner) across every caller.
 */

import { extractMainContent } from './contentExtractor/index.js';
import { buildExtractionOptions } from './contentExtractor/optionBuilder.js';
import type { ExtractResult } from './contentExtractor/types.js';
import type { CleansingConfig } from '../content/pageState.js';
import { PageState } from '../content/pageState.js';

// Re-export the domain type so callers don't need to import from the internal
// contentExtractor/types seam. One import, one module.
export type PageContent = ExtractResult;
export type { ExtractResult } from './contentExtractor/types.js';

/**
 * Prepare page content from the current document.
 *
 * Hides the two-step orchestration that every caller previously re-derived:
 *   buildExtractionOptions(config) → extractMainContent(maxChars, opts)
 *
 * The caller provides only the high-level CleansingConfig (or nothing for the
 * default pageState). All 32 rule flags, thresholds, and whitelist logic are
 * resolved inside.
 *
 * Pure with respect to the DOM: given the same document + config, returns the
 * same ExtractResult. No global pageState mutation — the caller decides what
 * to do with the result (locality).
 *
 * @param config - CleansingConfig, defaults to a fresh PageState's config when omitted
 * @param maxChars - maximum characters, defaults to 10000 (same as extractMainContent)
 */
export function preparePageContent(
  config?: CleansingConfig,
  maxChars: number = 10000,
): ExtractResult {
  // When no config is supplied, use a fresh PageState default. This keeps the
  // module free of global pageState coupling — the content script's
  // extractPageContent() wrapper still owns pageState, but direct callers
  // (tests, future pipeline steps) can supply an explicit config and stay pure.
  const effectiveConfig: CleansingConfig =
    config ?? new PageState().cleansingConfig;

  const { cleanseOptions, aiSummaryCleanseOptions, dedupOptions } =
    buildExtractionOptions(effectiveConfig);

  const result = extractMainContent(
    maxChars,
    cleanseOptions,
    aiSummaryCleanseOptions,
    dedupOptions,
  );

  return typeof result === 'string' ? { content: result } : result;
}

/**
 * Variant that accepts the raw option objects directly.
 * Kept private to the pipeline — not part of the public seam — but exposed
 * for the narrow case where a caller has already built options (e.g. legacy
 * extractor.ts shim). New code should use preparePageContent(config).
 */
export function prepareFromOptions(
  cleanseOptions: Parameters<typeof extractMainContent>[1],
  aiSummaryCleanseOptions: Parameters<typeof extractMainContent>[2],
  dedupOptions: Parameters<typeof extractMainContent>[3],
  maxChars: number = 10000,
): ExtractResult {
  const result = extractMainContent(
    maxChars,
    cleanseOptions,
    aiSummaryCleanseOptions,
    dedupOptions,
  );
  return typeof result === 'string' ? { content: result } : result;
}
