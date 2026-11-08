/**
 * wildcardToRegex-batch-d.test.ts — PBI 2026-11-08-17 (items 3, 4) pins.
 *
 * (3) Both branches enforce MAX_PATTERN_LENGTH: over-long patterns return
 * null (never match) instead of compiling unbounded input.
 * (4) matchSubdomains applies to plain patterns only; wildcard patterns
 * ignore the flag (documented policy — subdomain scope must be written
 * into the wildcard itself, never OR-ed in silently).
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_PATTERN_LENGTH,
  MAX_WILDCARDS_PER_PATTERN,
  isDomainInList,
  matchesDomainPattern,
  wildcardToRegex,
} from '../wildcardToRegex.js';

describe('wildcardToRegex length cap (PBI 2026-11-08-17 item 3)', () => {
  it('keeps a 1024 budget with headroom over the longest legitimate input', () => {
    expect(MAX_PATTERN_LENGTH).toBe(1024);
    expect(MAX_WILDCARDS_PER_PATTERN).toBe(5);
  });

  it('returns null for an over-long non-wildcard pattern', () => {
    expect(wildcardToRegex('a'.repeat(MAX_PATTERN_LENGTH + 1))).toBeNull();
  });

  it('returns null for an over-long wildcard pattern', () => {
    const pattern = `*.${'a'.repeat(MAX_PATTERN_LENGTH)}`;
    expect(pattern.length).toBeGreaterThan(MAX_PATTERN_LENGTH);
    expect(wildcardToRegex(pattern)).toBeNull();
  });

  it('accepts a pattern at exactly the cap', () => {
    expect(wildcardToRegex('a'.repeat(MAX_PATTERN_LENGTH))).not.toBeNull();
  });

  it('treats over-long patterns as non-match in the matcher and list check', () => {
    const longPattern = 'a'.repeat(MAX_PATTERN_LENGTH + 1);
    expect(matchesDomainPattern(longPattern, longPattern)).toBe(false);
    expect(matchesDomainPattern(longPattern, longPattern, true)).toBe(false);
    expect(isDomainInList('example.com', [longPattern])).toBe(false);
  });
});

describe('matchSubdomains ignored for wildcards (PBI 2026-11-08-17 item 4)', () => {
  it('does not widen a wildcard match when the flag is on', () => {
    expect(matchesDomainPattern('sub.example.com', '*.example.com', true)).toBe(true);
    expect(matchesDomainPattern('example.com', '*.example.com', true)).toBe(false);
  });

  it('does not narrow a wildcard match when the flag is on', () => {
    expect(matchesDomainPattern('other.com', '*example.com', true)).toBe(
      matchesDomainPattern('other.com', '*example.com', false),
    );
  });

  it('keeps the flag effective for plain patterns', () => {
    expect(matchesDomainPattern('sub.example.com', 'example.com', true)).toBe(true);
    expect(matchesDomainPattern('sub.example.com', 'example.com', false)).toBe(false);
  });

  it('requires wildcard subdomain scope to be written into the pattern', () => {
    expect(matchesDomainPattern('deep.sub.example.com', '*.example.com')).toBe(true);
    expect(matchesDomainPattern('deep.sub.example.com', 'sub.example.com', true)).toBe(true);
  });
});
