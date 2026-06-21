import { sanitizeForObsidian } from './markdownSanitizer.js';
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
