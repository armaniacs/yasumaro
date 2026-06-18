/**
 * obsidianFormatter.ts
 * Formats BrowsingLogEntry records as Obsidian-compatible markdown.
 * Pure function — no side effects, easily testable.
 */

import { sanitizeForObsidian } from '../utils/markdownSanitizer.js';
import type { BrowsingLogEntry } from '../utils/sqlite-types.js';

/**
 * Format a single BrowsingLogEntry as an Obsidian markdown list item.
 * - HH:MM [Title](url)
 *     - Summary text
 *
 * appendedAt is the current time (Date.now()) when the user manually appended,
 * not the original recording time stored in entry.created_at.
 */
function formatSingleEntry(entry: BrowsingLogEntry, appendedAt: number): string {
  // Use the time when the user manually appended, not the original recording time
  const timestamp = new Date(appendedAt).toLocaleTimeString('ja-JP', {
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
  const appendedAt = Date.now();
  return entries.map(entry => formatSingleEntry(entry, appendedAt)).join('\n');
}
