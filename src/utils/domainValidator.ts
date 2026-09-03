import { wildcardToRegex } from './wildcardToRegex.js';

/**
 * Validate a single domain or wildcard pattern.
 *
 * Syntax check shared by the dashboard save path (via DomainFilter)
 * and the legacy domainUtils validator. The bounded {0,61} quantifier
 * and non-nested label groups keep this linear (no catastrophic
 * backtracking); wildcard handling delegates to the single
 * ReDoS-guarded wildcardToRegex engine.
 */
export function isValidDomainPattern(domain: unknown): boolean {
  if (!domain || typeof domain !== 'string') {
    return false;
  }

  if (domain.includes('*') && wildcardToRegex(domain) === null) {
    return false;
  }

  const domainPattern = /^(\*\.)*[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

  return domainPattern.test(domain);
}
