import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatEntryToHeadingMarkdown, formatEntriesToObsidianList, buildEntryMarkdown } from '../markdownFormatter.js';
import type { BrowsingLogEntry } from '../sqlite-types.js';

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
};

describe('markdownFormatter', () => {
  it('formats a single entry', () => {
    const md = formatEntryToHeadingMarkdown(baseEntry);
    expect(md).toContain('# Example Article');
    expect(md).toContain('https://example.com/article');
    expect(md).toContain('This is a summary.');
    expect(md).toContain('#tech #ai');
  });

  it('formats multiple entries as obsidianList items joined by newlines', () => {
    const entry2 = { ...baseEntry, id: 2, title: 'Second Article', tags: 'news' };
    const md = formatEntriesToObsidianList([baseEntry, entry2]);
    expect(md).toContain('[Example Article](https://example.com/article)');
    expect(md).toContain('[Second Article](https://example.com/article)');
    expect(md).not.toContain('---');
  });

  it('handles missing title', () => {
    const md = formatEntryToHeadingMarkdown({ ...baseEntry, title: '' });
    expect(md).toContain('# https://example.com/article');
  });

  it('handles empty tags', () => {
    const md = formatEntryToHeadingMarkdown({ ...baseEntry, tags: '' });
    expect(md).toContain('# Example Article');
    expect(md).not.toContain('- Tags:');
  });

  it('filters out empty tag segments', () => {
    const md = formatEntryToHeadingMarkdown({ ...baseEntry, tags: 'tech,' });
    expect(md).toContain('- Tags: #tech');
    expect(md).not.toContain('# #');
  });

  it('handles missing tags', () => {
    const md = formatEntryToHeadingMarkdown({ ...baseEntry, tags: undefined as unknown as string });
    expect(md).not.toContain('- Tags:');
  });

  it('uses fallback when summary is missing', () => {
    const md = formatEntryToHeadingMarkdown({ ...baseEntry, summary: '' });
    expect(md).toContain('Summary not available.');
  });

  it('returns empty string for empty array', () => {
    expect(formatEntriesToObsidianList([])).toBe('');
  });

  it('returns empty string for undefined/null input', () => {
    expect(formatEntriesToObsidianList(undefined as unknown as BrowsingLogEntry[])).toBe('');
    expect(formatEntriesToObsidianList(null as unknown as BrowsingLogEntry[])).toBe('');
  });

  it('escapes markdown links in title via sanitizeForObsidian', () => {
    const entry = { ...baseEntry, title: 'Read [more](https://example.com) here' };
    const md = formatEntryToHeadingMarkdown(entry);
    expect(md).toContain('# Read \\[more\\]\\(https://example.com\\) here');
  });

  it('escapes markdown links in URL via sanitizeForObsidian', () => {
    const entry = { ...baseEntry, url: 'https://example.com/[click](https://evil.com)' };
    const md = formatEntryToHeadingMarkdown(entry);
    expect(md).toContain('- URL: https://example.com/\\[click\\]\\(https://evil.com\\)');
  });

  it('escapes markdown links in tags via link-text + obsidian sanitizers', () => {
    const entry = { ...baseEntry, tags: '[promo](https://evil.com),ai' };
    const md = formatEntryToHeadingMarkdown(entry);
    // sanitizeForObsidian escapes the link, sanitizeForMarkdownLinkText escapes
    // the resulting brackets/parens a second time (join-boundary safety).
    expect(md).toContain('- Tags: #\\\\[promo\\\\]\\\\(https://evil.com\\\\) #ai');
  });

  it('escapes standalone ] in the title (link-text boundary safety)', () => {
    const title = 'Title with ] and #';
    const md = formatEntryToHeadingMarkdown({ ...baseEntry, title });
    expect(md).toContain('# Title with \\] and #');
  });
});

describe('buildEntryMarkdown (PBI-04 SSOT)', () => {
  const FIXED_NOW = new Date('2026-03-15T09:30:00.000Z').getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('obsidianList delegates to the same output as formatEntriesToObsidianList', () => {
    const viaPublic = formatEntriesToObsidianList([baseEntry]);
    const viaSSOT = buildEntryMarkdown(
      { title: baseEntry.title, url: baseEntry.url, summary: baseEntry.summary, appendedAt: FIXED_NOW },
      'obsidianList',
    );
    expect(viaSSOT).toBe(viaPublic);
  });

  it('heading delegates to the same output as formatEntryToHeadingMarkdown', () => {
    const viaSSOT = buildEntryMarkdown(
      {
        title: baseEntry.title,
        url: baseEntry.url,
        summary: baseEntry.summary,
        tags: baseEntry.tags,
        createdAt: baseEntry.created_at,
      },
      'heading',
      { urlMode: 'obsidian' },
    );
    expect(viaSSOT).toBe(formatEntryToHeadingMarkdown(baseEntry));
  });

  it('plainLine renders a single line and omits a missing summary', () => {
    expect(
      buildEntryMarkdown({ title: 'T', url: 'https://example.com', summary: 's' }, 'plainLine'),
    ).toBe('- [T](https://example.com): s');
    expect(
      buildEntryMarkdown(
        { title: 'T', url: 'https://example.com', summary: null },
        'plainLine',
        { normalizeSummary: false, summaryFallback: null },
      ),
    ).toBe('- [T](https://example.com)');
  });

  it('prefixes array tags with # in obsidianList order', () => {
    const md = buildEntryMarkdown(
      { title: 'T', url: 'https://example.com', summary: 's', tags: ['a', 'b'], timestamp: '09:30' },
      'obsidianList',
    );
    expect(md).toBe('- 09:30 [T](https://example.com)\n    - #a #b s');
  });

  it('neutralizes link-breakout fragments in title and tags', () => {
    const evil = 'https://evil.example';
    const md = buildEntryMarkdown(
      { title: `Doc](${evil})`, url: 'https://example.com', summary: 's', tags: [`x](${evil})`], timestamp: '09:30' },
      'obsidianList',
    );
    expect(md).not.toContain(`](${evil})`);
    expect(md).toContain('](https://example.com)');
  });
});
