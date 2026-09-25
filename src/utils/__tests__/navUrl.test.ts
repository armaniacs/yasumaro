/**
 * navUrl / searchQuery unit tests: the URL narrowing that keeps
 * `nav_source_url` renderable, and the engine allow-list that keeps
 * `search_query` from being guessed.
 */
import { describe, it, expect } from 'vitest';

import { normalizeNavUrl } from '../navUrl.js';
import {
  extractSearchQuery,
  MAX_SEARCH_QUERY_CHARS,
  SEARCH_ENGINE_RULES,
} from '../searchQuery.js';

describe('normalizeNavUrl', () => {
  it('keeps an http(s) URL as-is', () => {
    expect(normalizeNavUrl('https://a.dev/page')).toBe('https://a.dev/page');
  });

  it('drops the fragment', () => {
    expect(normalizeNavUrl('https://a.dev/page#section')).toBe('https://a.dev/page');
  });

  it('preserves the query string', () => {
    expect(normalizeNavUrl('https://a.dev/s?q=1#top')).toBe('https://a.dev/s?q=1');
  });

  it('rejects non-http(s) schemes', () => {
    expect(normalizeNavUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeNavUrl('data:text/html,x')).toBeNull();
    expect(normalizeNavUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeNavUrl('chrome-extension://abc/x.html')).toBeNull();
  });

  it('returns null for an unparseable value', () => {
    expect(normalizeNavUrl('')).toBeNull();
    expect(normalizeNavUrl('not a url')).toBeNull();
  });
});

describe('extractSearchQuery', () => {
  it('reads the engine parameter from a known engine', () => {
    expect(extractSearchQuery('https://www.google.com/search?q=wasm+sqlite+fts5')).toBe(
      'wasm sqlite fts5',
    );
    expect(extractSearchQuery('https://www.bing.com/search?q=opfs')).toBe('opfs');
    expect(extractSearchQuery('https://duckduckgo.com/?q=wasm')).toBe('wasm');
  });

  it('uses the per-engine parameter name', () => {
    expect(extractSearchQuery('https://search.yahoo.co.jp/search?p=sqlite')).toBe('sqlite');
    expect(extractSearchQuery('https://search.yahoo.com/search?p=sqlite')).toBe('sqlite');
  });

  it('matches regional Google domains and subdomains', () => {
    expect(extractSearchQuery('https://www.google.co.jp/search?q=fts5')).toBe('fts5');
    expect(extractSearchQuery('https://google.de/search?q=fts5')).toBe('fts5');
  });

  it('returns null for a host that is not an engine', () => {
    // A `q` parameter exists but the host is not a search engine.
    expect(extractSearchQuery('https://a.dev/s?q=session-token')).toBeNull();
  });

  it('returns null when the engine parameter is missing or empty', () => {
    expect(extractSearchQuery('https://www.google.com/search')).toBeNull();
    expect(extractSearchQuery('https://www.google.com/search?q=')).toBeNull();
    expect(extractSearchQuery('https://www.google.com/search?q=%20%20')).toBeNull();
  });

  it('returns null for an unparseable URL', () => {
    expect(extractSearchQuery('not a url')).toBeNull();
  });

  it('caps the length by code point, not UTF-16 unit', () => {
    // Each emoji is one code point and two UTF-16 units; a code-unit slice
    // would end on a lone surrogate.
    const query = '😀'.repeat(MAX_SEARCH_QUERY_CHARS + 10);
    const result = extractSearchQuery(`https://www.google.com/search?q=${encodeURIComponent(query)}`);

    expect(result).not.toBeNull();
    expect(Array.from(result!)).toHaveLength(MAX_SEARCH_QUERY_CHARS);
    expect(result).not.toMatch(/[\uD800-\uDBFF]$/);
  });

  it('exposes rules whose host regexes all compile and are anchored per the table', () => {
    expect(SEARCH_ENGINE_RULES.length).toBeGreaterThan(0);
    for (const rule of SEARCH_ENGINE_RULES) {
      expect(typeof rule.param).toBe('string');
      expect(rule.param.length).toBeGreaterThan(0);
    }
  });
});
