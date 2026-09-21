/**
 * pipelineText.ts
 * Single owner of the pipeline summary-text priority.
 *
 * Previously the priority lived in two private `||` chains
 * (extractSentencesStep's extraction input and formatMarkdownStep's display
 * summary) that could drift apart. Both steps now delegate here; only
 * presentation transforms stay in the steps (extract's `''` default is the
 * selector's terminal value, format's display fallback is applied by the step).
 */

import type { RecordingContext } from './types.js';

/**
 * Display fallback for when every text source is empty.
 * Applied by formatMarkdownStep as its presentation transform; kept here so
 * the literal has one home. Must stay byte-equal to 'Summary not available.'.
 */
export const PIPELINE_TEXT_EMPTY_FALLBACK = 'Summary not available.';

/**
 * Narrow read surface for text selection. Both pipeline steps pass their full
 * RecordingContext; unit tests may pass plain objects with these fields.
 */
export type PipelineTextSource = Pick<
  RecordingContext,
  'extractedSentences' | 'sanitizedSummary' | 'privacyResult' | 'truncatedContent'
>;

/**
 * Resolve the pipeline summary text from a single canonical priority:
 * extractedSentences (joined with '\n\n') > sanitizedSummary >
 * privacyResult.summary > truncatedContent > ''.
 *
 * Pure function: no logging, no storage, no side effects. Empty string and
 * undefined count as missing (same falsy semantics as the former `||` chains).
 */
export function selectPipelineText(context: PipelineTextSource): string {
  const { extractedSentences, sanitizedSummary, privacyResult, truncatedContent } = context;
  if (extractedSentences && extractedSentences.length > 0) {
    return extractedSentences.join('\n\n');
  }
  return sanitizedSummary || privacyResult?.summary || truncatedContent || '';
}
