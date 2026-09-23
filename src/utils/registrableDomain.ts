// @layer 0 — Foundation: registrable-domain (eTLD+1) derivation for throttle scoping.

/**
 * Minimal multi-label public-suffix set. A heuristic — not the full PSL.
 *
 * A heuristic is sufficient for throttle scoping: for an unknown multi-label
 * suffix the fallback (last two labels) only widens the shared window to more
 * subdomains than strictly necessary, trading availability, never granting
 * extra quota to an attacker.
 */
const MULTI_LABEL_SUFFIXES: ReadonlySet<string> = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'co.jp',
  'ne.jp',
  'or.jp',
  'com.au',
  'co.nz',
]);

const IPV4_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * Derive the registrable domain (eTLD+1) of a hostname.
 *
 * Returns null when eTLD+1 is undefined for the host — localhost, IP
 * literals, single-label names — so callers can fall back to a narrower
 * key (e.g. the port-suffixed origin) instead of merging unrelated hosts.
 */
export function getRegistrableDomain(hostname: string): string | null {
  const normalized = hostname.toLowerCase().replace(/\.+$/, '');
  if (normalized === '') return null;
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return null;
  if (normalized.includes(':') || IPV4_PATTERN.test(normalized)) return null;
  const labels = normalized.split('.');
  if (labels.length < 2) return null;
  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_LABEL_SUFFIXES.has(lastTwo)) {
    return labels.length >= 3 ? labels.slice(-3).join('.') : normalized;
  }
  return lastTwo;
}
