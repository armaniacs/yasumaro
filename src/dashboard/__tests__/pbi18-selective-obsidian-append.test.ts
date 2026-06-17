/**
 * pbi18-selective-obsidian-append.test.ts
 * Tests for PBI-18: Selective Obsidian append
 *
 * Covers:
 * 1. formatEntriesToMarkdown — pure function, Obsidian-compatible markdown output
 * 2. appendToLogs — SW message-passing proxy for append_to_obsidian
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BrowsingLogEntry } from '../../utils/sqlite-types.js';

// ============================================================================
// formatEntriesToMarkdown
// ============================================================================

import { formatEntriesToMarkdown } from '../obsidianFormatter.js';

describe('formatEntriesToMarkdown', () => {
  it('returns empty string for empty array', () => {
    expect(formatEntriesToMarkdown([])).toBe('');
  });

  it('returns correct markdown for a single entry', () => {
    const entry: BrowsingLogEntry = {
      id: 1,
      url: 'https://example.com/page',
      title: 'Example Page',
      summary: 'A short summary',
      domain: 'example.com',
      created_at: new Date('2026-06-15T10:30:00+09:00').getTime(),
      tags: null,
      visit_duration: null,
      scroll_ratio: null,
      is_starred: 0,
      obsidian_synced: 0,
    };

    const md = formatEntriesToMarkdown([entry]);
    const lines = md.split('\n');

    expect(lines[0]).toMatch(/^- \d{2}:\d{2} \[Example Page\]\(https:\/\/example\.com\/page\)$/);
    expect(lines[1]).toBe('    - A short summary');
  });

  it('joins multiple entries with newlines', () => {
    const entries: BrowsingLogEntry[] = [
      {
        id: 1,
        url: 'https://a.com',
        title: 'First',
        summary: 'Summary 1',
        domain: 'a.com',
        created_at: Date.now(),
        tags: null,
        visit_duration: null,
        scroll_ratio: null,
        is_starred: 0,
        obsidian_synced: 0,
      },
      {
        id: 2,
        url: 'https://b.com',
        title: 'Second',
        summary: 'Summary 2',
        domain: 'b.com',
        created_at: Date.now(),
        tags: null,
        visit_duration: null,
        scroll_ratio: null,
        is_starred: 0,
        obsidian_synced: 0,
      },
    ];

    const md = formatEntriesToMarkdown(entries);
    const lines = md.split('\n');

    expect(lines.length).toBe(4);
    expect(lines[0]).toContain('[First]');
    expect(lines[2]).toContain('[Second]');
  });

  it('handles null/undefined title, summary, and domain', () => {
    const entry: BrowsingLogEntry = {
      id: 1,
      url: 'https://fallback.com',
      title: null,
      summary: null,
      domain: null,
      created_at: Date.now(),
      tags: null,
      visit_duration: null,
      scroll_ratio: null,
      is_starred: 0,
      obsidian_synced: 0,
    };

    const md = formatEntriesToMarkdown([entry]);
    const lines = md.split('\n');

    // Falls back to url for title
    expect(lines[0]).toContain('[https://fallback.com](https://fallback.com)');
    // Falls back to default summary
    expect(lines[1]).toBe('    - Summary not available.');
  });

  it('uses url as title fallback when title is empty string', () => {
    const entry: BrowsingLogEntry = {
      id: 1,
      url: 'https://empty-title.com',
      title: '',
      summary: 'Has summary',
      domain: 'empty-title.com',
      created_at: Date.now(),
      tags: null,
      visit_duration: null,
      scroll_ratio: null,
      is_starred: 0,
      obsidian_synced: 0,
    };

    const md = formatEntriesToMarkdown([entry]);
    expect(md).toContain(`[https://empty-title.com](https://empty-title.com)`);
  });

  it('sanitizes markdown links in title', () => {
    const entry: BrowsingLogEntry = {
      id: 1,
      url: 'https://evil.com',
      title: 'Click [here](https://malicious.com) now',
      summary: 'Normal summary',
      domain: 'evil.com',
      created_at: Date.now(),
      tags: null,
      visit_duration: null,
      scroll_ratio: null,
      is_starred: 0,
      obsidian_synced: 0,
    };

    const md = formatEntriesToMarkdown([entry]);
    // sanitizeForObsidian escapes markdown links: [text](url) → \[text\](url)
    expect(md).toContain('\\[here\\]');
    // The unescaped markdown link should NOT appear as a clickable link
    expect(md).not.toContain('Click [here](https://malicious.com) now');
  });

  it('sanitizes markdown links in summary', () => {
    const entry: BrowsingLogEntry = {
      id: 1,
      url: 'https://example.com',
      title: 'Safe Title',
      summary: 'See [this link](https://phish.com) for details',
      domain: 'example.com',
      created_at: Date.now(),
      tags: null,
      visit_duration: null,
      scroll_ratio: null,
      is_starred: 0,
      obsidian_synced: 0,
    };

    const md = formatEntriesToMarkdown([entry]);
    const summaryLine = md.split('\n')[1];
    expect(summaryLine).toContain('\\[this link\\]');
    // The unescaped markdown link should NOT appear in the summary
    expect(summaryLine).not.toContain('See [this link](https://phish.com) for details');
  });

  it('normalizes newlines in summary to spaces', () => {
    const entry: BrowsingLogEntry = {
      id: 1,
      url: 'https://example.com',
      title: 'Title',
      summary: 'Line one\nLine two\n\nLine three',
      domain: 'example.com',
      created_at: Date.now(),
      tags: null,
      visit_duration: null,
      scroll_ratio: null,
      is_starred: 0,
      obsidian_synced: 0,
    };

    const md = formatEntriesToMarkdown([entry]);
    const summaryLine = md.split('\n')[1];
    expect(summaryLine).toBe('    - Line one Line two Line three');
  });

  it('handles undefined entries gracefully', () => {
    expect(formatEntriesToMarkdown(undefined as unknown as BrowsingLogEntry[])).toBe('');
    expect(formatEntriesToMarkdown(null as unknown as BrowsingLogEntry[])).toBe('');
  });
});

// ============================================================================
// appendToLogs
// ============================================================================

function givenResponse(response: unknown) {
  (globalThis as any).chrome.runtime.sendMessage = vi.fn(
    (_message: unknown) => Promise.resolve(response),
  );
}

function givenLastError(errorMessage: string) {
  (globalThis as any).chrome.runtime.sendMessage = vi.fn(
    (_message: unknown) => Promise.reject(new Error(errorMessage)),
  );
}

import { appendToLogs } from '../dashboardSqliteService.js';

describe('appendToLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (!(globalThis as any).chrome) {
      (globalThis as any).chrome = {};
    }
    if (!(globalThis as any).chrome.runtime) {
      (globalThis as any).chrome.runtime = {};
    }
  });

  it('returns error result for empty ids array', async () => {
    givenResponse({ success: false, error: 'No IDs provided' });

    const result = await appendToLogs([]);

    expect(result).toEqual({ success: false, error: 'No IDs provided' });
  });

  it('sends correct message payload with ids', async () => {
    givenResponse({ success: true, appended: 2 });

    await appendToLogs([1, 2, 3]);

    expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'DASHBOARD_SQLITE',
      payload: { subtype: 'append_to_obsidian', ids: [1, 2, 3] },
    });
  });

  it('returns success with appended count on SW success', async () => {
    givenResponse({ success: true, appended: 5 });

    const result = await appendToLogs([10, 20, 30, 40, 50]);

    expect(result).toEqual({ success: true, appended: 5 });
  });

  it('falls back to ids.length when appended count not provided', async () => {
    givenResponse({ success: true });

    const result = await appendToLogs([1, 2]);

    expect(result).toEqual({ success: true, appended: 2 });
  });

  it('returns error result on SW failure response', async () => {
    givenResponse({ success: false, error: 'Obsidian connection refused' });

    const result = await appendToLogs([1]);

    expect(result).toEqual({ success: false, error: 'Obsidian connection refused' });
  });

  it('returns generic error when SW response has no error message', async () => {
    givenResponse({ success: false });

    const result = await appendToLogs([1]);

    expect(result).toEqual({ success: false, error: 'Append failed' });
  });

  it('returns null on exception (SW rejection)', async () => {
    givenLastError('Service worker unavailable');

    const result = await appendToLogs([1]);

    expect(result).toBeNull();
  });
});
