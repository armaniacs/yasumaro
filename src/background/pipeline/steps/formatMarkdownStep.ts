/**
 * Format markdown step
 * Step 7: Format sanitized content as Obsidian markdown
 * Uses L0 extracted sentences when available for token reduction
 */

import { getUserLocale } from '../../../utils/localeUtils.js';
import { buildEntryMarkdown, buildTemplateEntryData } from '../../../utils/markdownFormatter.js';
import type { RecordingContext, PipelineStepFunction } from '../types.js';
import { PIPELINE_TEXT_EMPTY_FALLBACK, selectPipelineText } from '../pipelineText.js';

/**
 * Format content as markdown for Obsidian
 * P1: XSS対策 - summaryをサニタイズ（Markdownリンクのエスケープ）
 */
export const formatMarkdownStep: PipelineStepFunction = async (
  context: RecordingContext
): Promise<RecordingContext> => {
  const { data, privacyResult } = context;
  const { url, title } = data;

  // Text selection is single-owned by selectPipelineText (pipelineText.ts):
  // extractedSentences (joined with '\n\n') > sanitizedSummary >
  // privacyResult.summary > truncatedContent > ''. The display fallback below
  // is this step's presentation transform and stays here byte-equal.
  const summary = selectPipelineText(context) || PIPELINE_TEXT_EMPTY_FALLBACK;

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
