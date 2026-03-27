/**
 * Format markdown step
 * Step 7: Format sanitized content as Obsidian markdown
 */

import { getUserLocale } from '../../../utils/localeUtils.js';
import { sanitizeForObsidian } from '../../../utils/markdownSanitizer.js';
import type { RecordingContext, PipelineStepFunction } from '../types.js';

/**
 * Format content as markdown for Obsidian
 * P1: XSS対策 - summaryをサニタイズ（Markdownリンクのエスケープ）
 */
export const formatMarkdownStep: PipelineStepFunction = async (
  context: RecordingContext
): Promise<RecordingContext> => {
  const { data, privacyResult, sanitizedSummary } = context;
  const { url, title } = data;

  const summary = sanitizedSummary || privacyResult?.summary || 'Summary not available.';

  // Sanitize for Obsidian (XSS protection)
  const sanitizedTitle = sanitizeForObsidian(title);
  const finalSanitizedSummary = sanitizeForObsidian(summary);

  // Format timestamp
  const timestamp = new Date().toLocaleTimeString(getUserLocale(), {
    hour: '2-digit',
    minute: '2-digit'
  });

  // Create markdown
  const markdown = `- ${timestamp} [${sanitizedTitle}](${url})\n    - AI要約: ${finalSanitizedSummary}`;

  return {
    ...context,
    sanitizedSummary: finalSanitizedSummary,
    markdown
  };
};
