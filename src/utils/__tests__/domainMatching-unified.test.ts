import { describe, it, expect } from 'vitest';
import {
  matchesDomainPattern,
  isDomainInList as isDomainInListShared,
  extractHostname,
  MAX_WILDCARDS_PER_PATTERN,
} from '../wildcardToRegex.js';
import {
  matchesPattern as domainUtilsMatches,
  isDomainInList as domainUtilsInList,
  extractDomain as domainUtilsExtract,
} from '../domainUtils.js';
import {
  matchesPattern as skipperMatches,
  isDomainInList as skipperInList,
  extractDomain as skipperExtract,
} from '../../content/urlSkipper.js';
import {
  matchesWildcardPattern,
  normalizeDomainUrl,
} from '../storage/domainFilterCache.js';
import { evaluateCachedAllow } from '../domainFilter/DomainFilter.js';

const CASES: Array<[string, string, boolean]> = [
  ['example.com', 'example.com', true],
  ['EXAMPLE.COM', 'example.com', true],
  ['example.com', 'EXAMPLE.COM', true],
  ['other.com', 'example.com', false],
  ['sub.example.com', '*.example.com', true],
  ['example.com', '*.example.com', false],
  ['sub.sub.example.com', '*.example.com', true],
  ['examplexxxcom', 'example*com', true],
];

describe('unified domain matching (PBI-18 single shared path)', () => {
  it.each(CASES)('canonical matchesDomainPattern(%s, %s) === %s', (domain, pattern, expected) => {
    expect(matchesDomainPattern(domain, pattern)).toBe(expected);
  });

  it('all entry points agree on every case', () => {
    for (const [domain, pattern, expected] of CASES) {
      expect(domainUtilsMatches(domain, pattern)).toBe(expected);
      expect(skipperMatches(domain, pattern)).toBe(expected);
      expect(matchesWildcardPattern(domain, pattern)).toBe(expected);
    }
  });

  it('isDomainInList shims agree with the canonical helper', () => {
    const list = ['example.com', '*.trusted.org'];
    expect(domainUtilsInList('sub.trusted.org', list)).toBe(true);
    expect(skipperInList('sub.trusted.org', list)).toBe(true);
    expect(isDomainInListShared('sub.trusted.org', list)).toBe(true);
    expect(domainUtilsInList('evil.com', list)).toBe(false);
    expect(skipperInList('evil.com', list)).toBe(false);
    expect(domainUtilsInList('x.com', undefined)).toBe(false);
    expect(skipperInList('x.com', undefined)).toBe(false);
  });

  it('hostname extraction shims agree', () => {
    for (const url of ['https://www.example.com/p', 'https://sub.example.com/', 'not-a-url']) {
      expect(domainUtilsExtract(url)).toBe(extractHostname(url));
      expect(skipperExtract(url)).toBe(extractHostname(url));
      expect(normalizeDomainUrl(url)).toBe(extractHostname(url));
    }
    expect(extractHostname('https://www.example.com/p')).toBe('example.com');
    expect(extractHostname('not-a-url')).toBeNull();
  });

  it('over-limit wildcards are rejected as non-match without throwing (ReDoS guard)', () => {
    const evil = `${'*.' .repeat(MAX_WILDCARDS_PER_PATTERN + 1)}example.com`;
    for (const fn of [matchesDomainPattern, domainUtilsMatches, skipperMatches, matchesWildcardPattern]) {
      expect(() => fn('sub.example.com', evil)).not.toThrow();
      expect(fn('sub.example.com', evil)).toBe(false);
    }
  });

  it('DomainFilter seam is consistent with the canonical matcher', () => {
    expect(evaluateCachedAllow('https://sub.example.com/p', ['*.example.com'], 'whitelist')).toBe(true);
    expect(evaluateCachedAllow('https://other.com/', ['*.example.com'], 'whitelist')).toBe(false);
    expect(evaluateCachedAllow('https://sub.example.com/p', ['*.example.com'], 'blacklist')).toBe(false);
  });
});
