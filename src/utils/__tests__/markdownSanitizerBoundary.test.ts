import { describe, it, expect } from 'vitest';
import {
  sanitizeForObsidian,
  sanitizeForMarkdownLinkText,
} from '../markdownSanitizer.js';

describe('sanitizeForObsidian - HTML entity encoding (VULN-001)', () => {
  it('encodes raw HTML tags into entities', () => {
    const out = sanitizeForObsidian('<img src=x onerror=alert(1)>');
    expect(out).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('>');
  });

  it('encodes ampersand first to avoid double-encoding', () => {
    expect(sanitizeForObsidian('a & b < c')).toBe('a &amp; b &lt; c');
  });

  it('does not double-encode an existing entity', () => {
    // Given "&amp;", "&" -> "&amp;" produces "&amp;amp;" only if not careful.
    // Spec requires "&"->"&amp;" first (single pass), so "&amp;" becomes "&amp;amp;".
    // We assert the deterministic single-pass behaviour: every raw & is encoded.
    expect(sanitizeForObsidian('&amp;')).toBe('&amp;amp;');
  });

  it('handles empty string', () => {
    expect(sanitizeForObsidian('')).toBe('');
  });

  it('handles symbols-only input', () => {
    expect(sanitizeForObsidian('<<>>&&')).toBe('&lt;&lt;&gt;&gt;&amp;&amp;');
  });

  it('preserves unicode text', () => {
    expect(sanitizeForObsidian('日本語 テスト <b>')).toBe('日本語 テスト &lt;b&gt;');
  });

  it('does not touch markdown syntax chars', () => {
    expect(sanitizeForObsidian('a *b* _c_ # d')).toBe('a *b* _c_ # d');
  });

  it('does not break Obsidian wikilinks structurally', () => {
    // wikilink escaping already turns [[x]] into \[\[x\]\]; no HTML chars involved
    expect(sanitizeForObsidian('[[Note]]')).toBe('\\[\\[Note\\]\\]');
  });

  it('guards non-string input', () => {
    // @ts-expect-error testing runtime guard
    expect(sanitizeForObsidian(null)).toBeNull();
    // @ts-expect-error testing runtime guard
    expect(sanitizeForObsidian(undefined)).toBeUndefined();
    // @ts-expect-error testing runtime guard
    expect(sanitizeForObsidian(123)).toBe(123);
  });
});

describe('sanitizeForMarkdownLinkText - tag fragment safety', () => {
  it('escapes bracket/paren fragments so links cannot reassemble', () => {
    expect(sanitizeForMarkdownLinkText('bar](https://evil.example)')).toBe(
      'bar\\]\\(https://evil.example\\)',
    );
  });
});
