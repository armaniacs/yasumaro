import { describe, it, expect } from 'vitest';
import { formatEntryToMarkdown, formatEntriesToGenericMarkdown } from '../markdownFormatter.js';
import { sanitizeForObsidian } from '../../utils/markdownSanitizer.js';
import type { BrowsingLogEntry } from '../../utils/sqlite-types.js';

const baseEntry: BrowsingLogEntry = {
  id: 1,
  url: 'https://example.com/article',
  title: 'Example Article',
  summary: 'This is a summary.',
  tags: 'tech,ai',
  created_at: 1718880000000,
  is_starred: 0,
  is_deleted: 0,
  scroll_ratio: 0.75,
  visit_duration: 12000,
  tokens_used: 150,
  content_length: 5000,
};

describe('markdownFormatter', () => {
  it('formats a single entry', () => {
    const md = formatEntryToMarkdown(baseEntry);
    expect(md).toContain('# Example Article');
    expect(md).toContain('https://example.com/article');
    expect(md).toContain('This is a summary.');
    expect(md).toContain('#tech #ai');
  });

  it('formats multiple entries', () => {
    const md = formatEntriesToGenericMarkdown([baseEntry]);
    expect(md).toContain('# Example Article');
  });

  it('handles missing title', () => {
    const md = formatEntryToMarkdown({ ...baseEntry, title: '' });
    expect(md).toContain('# https://example.com/article');
  });

  it('handles empty tags', () => {
    const md = formatEntryToMarkdown({ ...baseEntry, tags: '' });
    expect(md).toContain('# Example Article');
    expect(md).not.toContain('- Tags:');
  });

  it('filters out empty tag segments', () => {
    const md = formatEntryToMarkdown({ ...baseEntry, tags: 'tech,' });
    expect(md).toContain('- Tags: #tech');
    expect(md).not.toContain('# #');
  });

  it('handles missing tags', () => {
    const md = formatEntryToMarkdown({ ...baseEntry, tags: undefined as unknown as string });
    expect(md).not.toContain('- Tags:');
  });

  it('uses fallback when summary is missing', () => {
    const md = formatEntryToMarkdown({ ...baseEntry, summary: '' });
    expect(md).toContain('Summary not available.');
  });

  it('joins multiple entries with --- separator', () => {
    const entry2 = { ...baseEntry, id: 2, title: 'Second Article', tags: 'news' };
    const md = formatEntriesToGenericMarkdown([baseEntry, entry2]);
    expect(md).toContain('\n---\n\n');
    expect(md).toContain('# Example Article');
    expect(md).toContain('# Second Article');
  });

  it('returns empty string for empty array', () => {
    expect(formatEntriesToGenericMarkdown([])).toBe('');
  });

  it('returns empty string for undefined/null input', () => {
    expect(formatEntriesToGenericMarkdown(undefined as unknown as BrowsingLogEntry[])).toBe('');
    expect(formatEntriesToGenericMarkdown(null as unknown as BrowsingLogEntry[])).toBe('');
  });

  it('escapes markdown links in title via sanitizeForObsidian', () => {
    const entry = { ...baseEntry, title: 'Read [more](https://example.com) here' };
    const md = formatEntryToMarkdown(entry);
    expect(md).toContain('# Read \\[more\\]\\(https://example.com\\) here');
  });

  it('leaves standalone ] and # characters unchanged', () => {
    const title = 'Title with ] and #';
    expect(sanitizeForObsidian(title)).toBe(title);
    const md = formatEntryToMarkdown({ ...baseEntry, title });
    expect(md).toContain('# Title with ] and #');
  });
});
