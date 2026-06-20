import { describe, it, expect } from 'vitest';
import { formatEntryToMarkdown, formatEntriesToGenericMarkdown } from '../markdownFormatter.js';
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
});
