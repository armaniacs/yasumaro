import { useTimerClock } from '../../../testDir/waitPolicy.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatEntryToHeadingMarkdown, formatEntriesToObsidianList, buildEntryMarkdown, buildTemplateEntryData, TIMESTAMP_CACHE_MAX_ENTRIES } from '../markdownFormatter.js';
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
    useTimerClock();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('obsidianList delegates to the same output as formatEntriesToObsidianList', () => {
    const viaPublic = formatEntriesToObsidianList([baseEntry]);
    const viaSSOT = buildEntryMarkdown(
      { title: baseEntry.title, url: baseEntry.url, summary: baseEntry.summary, tags: baseEntry.tags, createdAt: baseEntry.created_at },
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

  // PBI 2026-10-18-16: the Obsidian route (formatMarkdownStep obsidianList) and
  // the gist route (plainLine, normalizeSummary: false) share this SSOT chain,
  // so both stop the whitespace-separated link spelling here.
  it('escapes the whitespace-separated link spelling in the summary (obsidianList route)', () => {
    const md = buildEntryMarkdown(
      { title: 'T', url: 'https://example.com', summary: 'click [here] (https://evil.example/phish)', timestamp: '09:30' },
      'obsidianList',
    );
    expect(md).toBe('- 09:30 [T](https://example.com)\n    - click \\[here\\] \\(https://evil.example/phish\\)');
  });

  it('escapes a newline-split payload on the gist route while keeping the raw newline (plainLine, normalizeSummary: false)', () => {
    const md = buildEntryMarkdown(
      { title: 'T', url: 'https://example.com', summary: 'click [here]\n(https://evil.example/phish)' },
      'plainLine',
      { normalizeSummary: false, summaryFallback: null },
    );
    expect(md).toBe('- [T](https://example.com): click \\[here\\]\n\\(https://evil.example/phish\\)');
  });

  it('normalizes newlines in title to spaces (obsidianList injection safety)', () => {
    const md = buildEntryMarkdown(
      { title: 'Line one\n    - injected', url: 'https://example.com/article', summary: 's' },
      'obsidianList',
    );
    expect(md).toContain('[Line one - injected](https://example.com/article)');
    expect(md.split('\n')).toHaveLength(2);
  });

  it('normalizes lone carriage returns in title (obsidianList injection safety)', () => {
    const md = buildEntryMarkdown(
      { title: 'Line one\r    - injected', url: 'https://example.com/article', summary: 's' },
      'obsidianList',
    );
    expect(md).toContain('[Line one - injected](https://example.com/article)');
    expect(md.split('\n')).toHaveLength(2);
  });

  it('keeps the heading title line single-line for newline titles', () => {
    const md = buildEntryMarkdown(
      { title: 'Evil\n# Forged heading', url: 'https://example.com/article', summary: 's' },
      'heading',
    );
    const firstLine = md.split('\n')[0];
    expect(firstLine).toBe('# Evil # Forged heading');
  });

  it('keeps the heading title line single-line for lone CR titles', () => {
    const md = buildEntryMarkdown(
      { title: 'Evil\r# Forged heading', url: 'https://example.com/article', summary: 's' },
      'heading',
    );
    const firstLine = md.split('\n')[0];
    expect(firstLine).toBe('# Evil # Forged heading');
  });

  // PBI 2026-10-11-03: Unicode line terminators are line breaks for CodeMirror-family
  // editors (Obsidian), so the "title is a single line" contract must cover them too.
  it('normalizes U+2028 in title to a space (obsidianList injection safety)', () => {
    const md = buildEntryMarkdown(
      { title: 'Line one\u2028    - injected', url: 'https://example.com/article', summary: 's' },
      'obsidianList',
    );
    expect(md).toContain('[Line one - injected](https://example.com/article)');
    expect(md.split('\n')).toHaveLength(2);
  });

  it('normalizes U+2029 and U+0085 in title to spaces', () => {
    const md = buildEntryMarkdown(
      { title: 'a\u2029b\u0085c\rd\ne', url: 'https://example.com/article', summary: 's' },
      'obsidianList',
    );
    expect(md).toContain('[a b c d e](https://example.com/article)');
    expect(md.split('\n')).toHaveLength(2);
  });

  it('keeps the heading title line single-line for U+2028 titles', () => {
    const md = buildEntryMarkdown(
      { title: 'Evil\u2028# Forged heading', url: 'https://example.com/article', summary: 's' },
      'heading',
    );
    expect(md.split('\n')[0]).toBe('# Evil # Forged heading');
  });

  // PBI 2026-10-16-01: batch path carries tags + per-entry created_at time.
  it('batch rows carry tags and per-entry created_at times', () => {
    const entry2 = { ...baseEntry, id: 2, title: 'Second Article', tags: 'news', created_at: baseEntry.created_at + 3_600_000 };
    const md = formatEntriesToObsidianList([baseEntry, entry2]);
    expect(md).toContain('#tech #ai');
    expect(md).toContain('#news');
    const row1 = md.split('\n').find((l) => l.includes('[Example Article]'))!;
    const row2 = md.split('\n').find((l) => l.includes('[Second Article]'))!;
    expect(row1.split(' ')[1]).not.toBe(row2.split(' ')[1]);
  });

  // PBI 2026-10-16-01: heading keeps intentional blank lines.
  it('heading keeps blank lines between sections', () => {
    const md = formatEntryToHeadingMarkdown(baseEntry);
    const lines = md.split('\n');
    expect(lines[1]).toBe('');
    const summaryIdx = lines.indexOf('## Summary');
    expect(lines[summaryIdx - 1]).toBe('');
    expect(lines[summaryIdx + 1]).toBe('');
  });

  // PBI 2026-10-16-01: tags strip the full LINE_TERMINATOR_PATTERN set.
  it('strips U+2028 in tags so no forged row appears', () => {
    const md = buildEntryMarkdown(
      { title: 'T', url: 'https://example.com', summary: 's', tags: ['a' + String.fromCharCode(0x2028) + '# forged'], timestamp: '09:30' },
      'obsidianList',
    );
    expect(md).not.toContain(String.fromCharCode(0x2028));
    expect(md.split('\n')).toHaveLength(2);
  });

  it('does not throw when a non-string title is passed with titleFallback false', () => {
    expect(() =>
      buildEntryMarkdown(
        // Runtime shape from the background handler; the declared type is `string`.
        { title: undefined as unknown as string, url: 'https://example.com/article', summary: 's' },
        'obsidianList',
        { titleFallback: false },
      ),
    ).not.toThrow();
  });
});

describe('resolveTimestamp minute memoization (PBI 2026-10-15-02)', () => {
  // Local-time construction: the minute bucket must hold regardless of TZ.
  // Fresh hour per invocation: the module-level minute cache persists across
  // repeats in one worker, so each invocation needs an unseen minute key to
  // observe the miss-then-hit behavior deterministically (--repeats safe).
  let minuteSalt = 0;
  const freshBase = (): number => {
    const base = new Date(2026, 9, 1, 9, 5, 12).getTime() + minuteSalt * 3_600_000;
    minuteSalt += 1;
    return base;
  };
  const entry = (createdAt: number, url = 'https://example.com/a') =>
    buildTemplateEntryData({ title: 'T', url, createdAt }, { tagChain: 'obsidian' });

  it('formats same-minute timestamps with a single ICU call', () => {
    const spy = vi.spyOn(Date.prototype, 'toLocaleTimeString');
    try {
      const base = freshBase();
      const a = entry(base);
      const b = entry(base + 30_000, 'https://example.com/b');
      expect(a.timestamp).toBe(b.timestamp);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('formats across a minute boundary differently', () => {
    const base = freshBase();
    const a = entry(base + 47_999);
    const b = entry(base + 48_000);
    expect(a.timestamp).not.toBe(b.timestamp);
  });

  it('keeps an explicit timestamp out of the cache', () => {
    const spy = vi.spyOn(Date.prototype, 'toLocaleTimeString');
    try {
      const explicit = buildTemplateEntryData(
        { title: 'T', url: 'https://example.com/a', timestamp: 'custom' },
        { tagChain: 'obsidian' },
      );
      expect(explicit.timestamp).toBe('custom');
      expect(spy).not.toHaveBeenCalled();
      // The computed path for the same minute is unaffected by the explicit value.
      const base = freshBase();
      const computed = entry(base);
      expect(computed.timestamp).not.toBe('custom');
      expect(computed.timestamp).toBe(entry(base + 45_000).timestamp);
    } finally {
      spy.mockRestore();
    }
  });

  it('does not leak across timestampLocale values', () => {
    const base = freshBase();
    const ja1 = buildTemplateEntryData(
      { title: 'T', url: 'https://example.com/a', createdAt: base },
      { tagChain: 'obsidian', timestampLocale: 'ja-JP' },
    ).timestamp;
    const en = buildTemplateEntryData(
      { title: 'T', url: 'https://example.com/a', createdAt: base },
      { tagChain: 'obsidian', timestampLocale: 'en-US' },
    ).timestamp;
    const ja2 = buildTemplateEntryData(
      { title: 'T', url: 'https://example.com/a', createdAt: base },
      { tagChain: 'obsidian', timestampLocale: 'ja-JP' },
    ).timestamp;
    expect(ja2).toBe(ja1);
    expect(typeof en).toBe('string');
  });

  it('evicts the oldest minute once the cache exceeds TIMESTAMP_CACHE_MAX_ENTRIES', () => {
    const spy = vi.spyOn(Date.prototype, 'toLocaleTimeString');
    try {
      // Dedicated minute window, stepped wider than its own span on the shared
      // salt, so no key here can collide with another test's (or a --repeats
      // run's) cached minutes — the module-level cache persists across it()
      // bodies within one worker.
      const spanMinutes = TIMESTAMP_CACHE_MAX_ENTRIES + 60;
      const base = new Date(2026, 9, 1, 9, 5, 12).getTime() + minuteSalt * spanMinutes * 60_000;
      minuteSalt += 1;
      const overflow = 5;
      const total = TIMESTAMP_CACHE_MAX_ENTRIES + overflow;
      for (let i = 0; i < total; i++) {
        entry(base + i * 60_000, `https://example.com/m${i}`);
      }
      // Every key was new: one ICU call each.
      expect(spy).toHaveBeenCalledTimes(total);

      // The oldest minute was evicted to stay under the cap: recomputing it
      // misses the cache and costs one extra ICU call...
      const evicted = entry(base, 'https://example.com/m0-revisit');
      expect(spy).toHaveBeenCalledTimes(total + 1);
      // ...and the recomputed value matches what memoization produced before
      // (eviction costs a recompute, never a wrong value).
      expect(evicted.timestamp).toBe(entry(base, 'https://example.com/m0-revisit').timestamp);
      expect(spy).toHaveBeenCalledTimes(total + 1);

      // The most recent minute is still cached: no additional ICU call.
      entry(base + (total - 1) * 60_000, `https://example.com/m${total - 1}-revisit`);
      expect(spy).toHaveBeenCalledTimes(total + 1);
    } finally {
      spy.mockRestore();
    }
  });
});
