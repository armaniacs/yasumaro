/**
 * Format markdown step
 * Step 7: Format sanitized content as Obsidian markdown
 * Uses L0 extracted sentences when available for token reduction
 */

import { getUserLocale } from '../../../utils/localeUtils.js';
import { buildEntryMarkdown, buildTemplateEntryData } from '../../../utils/markdownFormatter.js';
import type { RecordingContext, PipelineStepFunction } from '../types.js';
import { PIPELINE_TEXT_EMPTY_FALLBACK, selectDisplayText } from '../pipelineText.js';

/**
 * Format content as markdown for Obsidian
 * P1: XSS対策 - summaryをサニタイズ（Markdownリンクのエスケープ）
 */
export const formatMarkdownStep: PipelineStepFunction = async (
  context: RecordingContext
): Promise<RecordingContext> => {
  // PBI 2026-09-25-13: the offline replay re-runs this step via retrySteps,
  // but the payload carries the pipeline-final markdown — regenerating it
  // would produce a new timestamp, break the byte-identical replay body, and
  // let the section editor stack a duplicate. Frozen markdown wins.
  if (context.markdown) {
    return context;
  }

  const { data, privacyResult } = context;
  const { url, title } = data;

  // Display text is single-owned by selectDisplayText (pipelineText.ts):
  // extractedSentences (joined with '\n\n') > sanitizedSummary >
  // privacyResult.summary > truncatedContent > ''. The display fallback below
  // is this step's presentation transform and stays here byte-equal.
  const summary = selectDisplayText(context) || PIPELINE_TEXT_EMPTY_FALLBACK;

  // Sanitize + assemble through the entry-markdown SSOT (PBI-04). The title
  // is placed inside `[title](url)`, so the SSOT escapes link-breakout chars
  // (VULN-001); AI tags are sanitized per tag before `#` interpolation
  // (VULN-008). summaryFallback is null because the summary priority chain
  // above already resolved the final text; titleFallback is false because
  // RecordingData.title is required (no URL fallback legacy).
  // WHY one preformatted timestamp: markdown and markdownEntryData must share
  // a single instant (minute-boundary safe), so it is computed once here and
  // passed as a literal instead of letting each builder call Date.now().
  const timestamp = new Date().toLocaleTimeString(getUserLocale(), {
    hour: '2-digit',
    minute: '2-digit'
  });
  const tags = privacyResult?.tags;
  const entryInput = {
    title,
    url,
    summary,
    tags: tags ?? null,
    timestamp,
  };
  const entryOpts = { titleFallback: false, summaryFallback: null } as const;
  const entryData = buildTemplateEntryData(entryInput, entryOpts);
  const markdown = buildEntryMarkdown(entryInput, 'obsidianList', entryOpts);

  return {
    ...context,
    sanitizedSummary: entryData.summary,
    markdown,
    markdownEntryData: entryData,
  };
};
