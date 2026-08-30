import { describe, it, expect } from 'vitest';
import { yamlQuote, yamlQuoteList } from '../yamlFrontmatter.js';

describe('yamlQuote', () => {
  it('wraps a plain value in double quotes', () => {
    expect(yamlQuote('hello')).toBe('"hello"');
  });

  it('neutralizes newline + injected key so it cannot resolve at column 0', () => {
    const evil = 'https://example.com\nbuild_meta: pwned';
    const out = yamlQuote(evil);
    expect(out).not.toContain('\n');
    expect(out.startsWith('"') && out.endsWith('"')).toBe(true);
    // No line in the emitted value begins with an injected mapping key.
    expect(out.split('\n').some(l => /^build_meta:/.test(l))).toBe(false);
  });

  it('escapes embedded double quotes and backslashes', () => {
    expect(yamlQuote('a"b\\c')).toBe('"a\\"b\\\\c"');
  });

  it('collapses carriage return and tab', () => {
    expect(yamlQuote('a\r\tb')).toBe('"a  b"');
  });

  it('handles null / undefined as empty string', () => {
    expect(yamlQuote(null)).toBe('""');
    expect(yamlQuote(undefined)).toBe('""');
  });
});

describe('yamlQuoteList', () => {
  it('escapes every element', () => {
    expect(yamlQuoteList(['a', 'b"c'])).toBe('["a", "b\\"c"]');
  });

  it('neutralizes an injected key inside a tag', () => {
    const out = yamlQuoteList(['ok', 'x\ninjected: 1']);
    expect(out).not.toContain('\n');
  });
});
