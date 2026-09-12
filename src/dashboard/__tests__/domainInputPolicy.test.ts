import { describe, it, expect } from 'vitest';
import { normalizeDomainInput, validateDomainInput } from '../domainInputPolicy.js';
import { DomainFilter } from '../../utils/domainFilter/DomainFilter.js';

describe('DomainInputPolicy (PBI 2026-09-12-15)', () => {
  it('normalizes exactly once: trim → lowercase → strip scheme → strip path', () => {
    expect(normalizeDomainInput('  HTTPS://Example.COM/page?q=1 ')).toBe('example.com');
    expect(normalizeDomainInput('sub.example.com')).toBe('sub.example.com');
    expect(normalizeDomainInput('')).toBe('');
  });

  it('agrees with the save-path seam on a mixed matrix (parity)', () => {
    const filter = new DomainFilter();
    const matrix = [
      'example.com',
      'EXAMPLE.COM',
      '*.example.com',
      'sub.example.com',
      'https://example.com/page',
      'invalid domain!',
      'exa*mple.com',
      'a'.repeat(64) + '.com',
      '',
    ];
    for (const raw of matrix) {
      const normalized = normalizeDomainInput(raw);
      const policyVerdict = validateDomainInput(normalized);
      const seamVerdict = normalized
        ? filter.parseAndValidate([normalized]).errors.length === 0
        : false;
      expect(policyVerdict, `parity for ${JSON.stringify(raw)} → ${JSON.stringify(normalized)}`).toBe(seamVerdict);
    }
  });

  it('rejects ReDoS-shaped input like the save path does', () => {
    const hostile = 'a.*.*.*.*.*.com';
    const normalized = normalizeDomainInput(hostile);
    expect(validateDomainInput(normalized)).toBe(
      new DomainFilter().parseAndValidate([normalized]).errors.length === 0,
    );
  });
});
