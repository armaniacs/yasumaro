/**
 * obsidianFormatter.ts
 * Formats BrowsingLogEntry records as Obsidian-compatible markdown.
 * Pure function — no side effects, easily testable.
 */

import { sanitizeForObsidian } from '../utils/markdownSanitizer.js';
import type { BrowsingLogEntry } from '../utils/sqlite-types.js';

/**
 * Format a single BrowsingLogEntry as an Obsidian markdown list item.
 * Matches the format produced by formatMarkdownStep in the recording pipeline:
 * - HH:MM [Title](url)
 *     - Summary text
 *
 * Note: Timestamp uses ja-JP locale to match the pipeline's formatMarkdownStep.
 * This ensures consistency in Obsidian daily notes across auto-recording and manual append.
 */
function formatSingleEntry(entry: BrowsingLogEntry): string {
  // Use ja-JP locale to match formatMarkdownStep pipeline format
  const timestamp = new Date(entry.created_at).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const title = sanitizeForObsidian(entry.title || entry.url || 'Untitled');
  const url = entry.url;

  let summary = entry.summary || 'Summary not available.';
  // Normalize newlines to spaces (Obsidian list format breaks with newlines)
  summary = summary.replace(/\n+/g, ' ').replace(/  +/g, ' ').trim();
  const sanitizedSummary = sanitizeForObsidian(summary);

  return `- ${timestamp} [${title}](${url})\n    - ${sanitizedSummary}`;
}

/**
 * Format multiple BrowsingLogEntry records as Obsidian markdown.
 * Each entry becomes a list item, separated by newlines.
 *
 * @param entries - Array of browsing log entries to format
 * @returns Markdown string ready to append to Obsidian daily note
 */
export function formatEntriesToMarkdown(entries: BrowsingLogEntry[]): string {
  if (!entries || entries.length === 0) {
    return '';
  }
  return entries.map(formatSingleEntry).join('\n');
}
