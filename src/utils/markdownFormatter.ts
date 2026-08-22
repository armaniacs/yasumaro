import { sanitizeForObsidian, sanitizeForMarkdownLinkText, sanitizeUrlForMarkdownTarget } from './markdownSanitizer.js';
import type { BrowsingLogEntry } from './sqlite-types.js';

export function formatEntryToMarkdown(entry: BrowsingLogEntry): string {
  const title = sanitizeForObsidian(entry.title || entry.url || 'Untitled');
  const url = sanitizeForObsidian(entry.url);
  const summary = sanitizeForObsidian((entry.summary || 'Summary not available.').replace(/\n+/g, ' ').replace(/  +/g, ' ').trim());
  const tags = entry.tags
    ? entry.tags.split(',').map(t => t.trim()).filter(Boolean).map(t => `#${sanitizeForObsidian(t)}`).join(' ')
    : '';
  const date = new Date(entry.created_at).toLocaleString();

  return [
    `# ${title}`,
    ``,
    `- URL: ${url}`,
    `- Date: ${date}`,
    tags ? `- Tags: ${tags}` : '',
    ``,
    `## Summary`,
    ``,
    summary,
    '',
  ].filter(Boolean).join('\n');
}

export function formatEntriesToGenericMarkdown(entries: BrowsingLogEntry[]): string {
  if (!entries || entries.length === 0) return '';
  return entries.map(formatEntryToMarkdown).join('\n---\n\n');
}

/**
 * Format a single BrowsingLogEntry as an Obsidian markdown list item.
 * - HH:MM [Title](url)
 *     - Summary text
 */
function formatSingleEntry(entry: BrowsingLogEntry, appendedAt: number): string {
  const timestamp = new Date(appendedAt).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const title = sanitizeForMarkdownLinkText(entry.title || entry.url || 'Untitled');
  const url = sanitizeUrlForMarkdownTarget(entry.url);

  let summary = entry.summary || 'Summary not available.';
  summary = summary.replace(/\n+/g, ' ').replace(/  +/g, ' ').trim();
  const sanitizedSummary = sanitizeForObsidian(summary);

  return `- ${timestamp} [${title}](${url})\n    - ${sanitizedSummary}`;
}

/**
 * Format multiple BrowsingLogEntry records as Obsidian markdown.
 * Each entry becomes a list item, separated by newlines.
 */
export function formatEntriesToMarkdown(entries: BrowsingLogEntry[]): string {
  if (!entries || entries.length === 0) {
    return '';
  }
  const appendedAt = Date.now();
  return entries.map(entry => formatSingleEntry(entry, appendedAt)).join('\n');
}
