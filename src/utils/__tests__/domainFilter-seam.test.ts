import { describe, it, expect } from 'vitest';
import { DomainFilter, evaluateCachedAllow } from '../domainFilter/DomainFilter.js';
import { isValidDomain } from '../domainUtils.js';

describe('DomainFilter unified validation seam', () => {
  it('parseAndValidate agrees with isValidDomain on syntax', () => {
    const filter = new DomainFilter();
    const samples = ['example.com', '*.example.com', 'bad..pattern', 'a*b', '*.*.*.*.*.*'];
    for (const s of samples) {
      const { errors } = filter.parseAndValidate([s]);
      expect(errors.length === 0).toBe(isValidDomain(s));
    }
  });

  it('parseAndValidate rejects ReDoS-guarded wildcard overflow', () => {
    const filter = new DomainFilter();
    const { errors } = filter.parseAndValidate(['*.*.*.*.*.*.example.com']);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('evaluateCachedAllow is the single predicate for both adapters', () => {
    expect(evaluateCachedAllow('https://example.com/', ['example.com'], 'whitelist')).toBe(true);
    expect(evaluateCachedAllow('https://other.com/', ['example.com'], 'whitelist')).toBe(false);
    expect(evaluateCachedAllow('https://blocked.com/', ['blocked.com'], 'blacklist')).toBe(false);
    expect(evaluateCachedAllow('https://allowed.com/', ['blocked.com'], 'blacklist')).toBe(true);
    expect(evaluateCachedAllow('https://any.com/', [], 'disabled')).toBe(true);
    expect(evaluateCachedAllow('not-a-url', ['example.com'], 'whitelist')).toBeNull();
  });

  it('evaluateCachedAllow honors the subdomain toggle (PBI 2026-09-06-06)', () => {
    // toggle OFF (default): subdomains do not match
    expect(evaluateCachedAllow('https://sub.example.com/', ['example.com'], 'whitelist')).toBe(false);
    expect(evaluateCachedAllow('https://sub.example.com/', ['example.com'], 'blacklist')).toBe(true);
    // toggle ON: subdomains match
    expect(evaluateCachedAllow('https://sub.example.com/', ['example.com'], 'whitelist', true)).toBe(true);
    expect(evaluateCachedAllow('https://sub.example.com/', ['example.com'], 'blacklist', true)).toBe(false);
    // toggle ON: exact matches still work
    expect(evaluateCachedAllow('https://example.com/', ['example.com'], 'whitelist', true)).toBe(true);
    // toggle ON: unrelated domains still do not match
    expect(evaluateCachedAllow('https://notexample.com/', ['example.com'], 'whitelist', true)).toBe(false);
  });
});
