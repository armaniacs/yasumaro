/**
 * DomainInputPolicy — single normalize+validate policy for domain list input.
 *
 * The tag UI (`domainFilterTagUI.addDomain`) and the save path
 * (`DomainFilter.parseAndValidate`) used to validate through two different
 * seams: a hand-rolled `/^[a-z0-9.*-]+$/` regex vs the sole validation seam
 * (`isValidDomainPattern` + `wildcardToRegex` ReDoS guard). Either side could
 * accept what the other rejects. Both sides now share this module; the save
 * path stays authoritative.
 */
import { DomainFilter } from '../utils/domainFilter/DomainFilter.js';

/** Normalize raw tag input exactly once: trim → lowercase → strip scheme → strip path. */
export function normalizeDomainInput(rawInput: string): string {
  return rawInput.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

/** Single-entry validation through the sole validation seam. */
export function validateDomainInput(normalized: string): boolean {
  if (!normalized) return false;
  return new DomainFilter().parseAndValidate([normalized]).errors.length === 0;
}
