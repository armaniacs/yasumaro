/**
 * pipelineText.ts
 * Single owner of the pipeline summary-text priority.
 *
 * Previously the priority lived in two private `||` chains
 * (extractSentencesStep's extraction input and formatMarkdownStep's display
 * summary) that could drift apart. Both steps now delegate here; only
 * presentation transforms stay in the steps (extract's `''` default is the
 * selector's terminal value, format's display fallback is applied by the step).
 *
 * Stage split (Checking Team 2026-09-22, Domain Logic Medium): extraction
 * and display are DIFFERENT decisions. `selectExtractionInput` owns the
 * extraction priority (sanitizedSummary > privacyResult.summary >
 * truncatedContent) and structurally cannot see `extractedSentences` — the
 * output the extract step is about to produce — so a step retry can never
 * feed its own previous output back in. `selectDisplayText` owns the
 * display priority, where extractedSentences legitimately wins.
 */

import type { RecordingContext } from './types.js';

/**
 * Display fallback for when every text source is empty.
 * Applied by formatMarkdownStep as its presentation transform; kept here so
 * the literal has one home. Must stay byte-equal to 'Summary not available.'.
 */
export const PIPELINE_TEXT_EMPTY_FALLBACK = 'Summary not available.';

/**
 * Narrow read surface for display selection. formatMarkdownStep passes its
 * full RecordingContext; unit tests may pass plain objects with these fields.
 */
export type PipelineTextSource = Pick<
  RecordingContext,
  'extractedSentences' | 'sanitizedSummary' | 'privacyResult' | 'truncatedContent'
>;

/**
 * Narrow read surface for extraction input. `extractedSentences` is
 * deliberately absent: at the extract stage it is the step's own pending
 * output, never an input (retrying the step must not re-consume it).
 */
export type PipelineExtractionSource = Pick<
  RecordingContext,
  'sanitizedSummary' | 'privacyResult' | 'truncatedContent'
>;

/**
 * Resolve the extraction input from the canonical extraction priority:
 * sanitizedSummary > privacyResult.summary > truncatedContent > ''.
 *
 * Pure function: no logging, no storage, no side effects. Empty string and
 * undefined count as missing (same falsy semantics as the former `||` chain).
 */
export function selectExtractionInput(context: PipelineExtractionSource): string {
  return context.sanitizedSummary || context.privacyResult?.summary || context.truncatedContent || '';
}

/**
 * Resolve the pipeline display text from the canonical display priority:
 * extractedSentences (joined with '\n\n') > sanitizedSummary >
 * privacyResult.summary > truncatedContent > ''.
 *
 * Pure function: same falsy semantics as the former `||` chain.
 */
export function selectDisplayText(context: PipelineTextSource): string {
  const { extractedSentences, sanitizedSummary, privacyResult, truncatedContent } = context;
  if (extractedSentences && extractedSentences.length > 0) {
    return extractedSentences.join('\n\n');
  }
  return sanitizedSummary || privacyResult?.summary || truncatedContent || '';
}
