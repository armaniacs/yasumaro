/**
 * cspDomains.ts
 * Single source of truth for AI-provider host permission domains, shared
 * between wxt.config.ts's manifest permissions and its CSP connect-src
 * (M24). Adding a provider domain here updates both automatically instead
 * of requiring the CSP string to be edited by hand in a second place.
 */

import { ALL_LIST_SOURCES } from './listSources.js';
import { deriveOptionalDomains, deriveRequiredDomains } from './storage/providerAllowlist.js';

// Permission pattern, not a provider domain, so it stays a constant instead
// of a neutral-table row; anchored by value after the api.openai.com entry to
// preserve the legacy manifest order byte-identically.
const OPENAI_WILDCARD_PERMISSION = 'https://*.openai.com/*';

function withOpenaiWildcard(perms: string[]): string[] {
  const out = [...perms];
  const anchor = out.indexOf('https://api.openai.com/*');
  out.splice(anchor === -1 ? out.length : anchor + 1, 0, OPENAI_WILDCARD_PERMISSION);
  return out;
}

/** Always-granted AI provider host permissions (manifest `host_permissions`). */
export const AI_PROVIDER_HOST_PERMISSIONS: readonly string[] = withOpenaiWildcard(
  deriveRequiredDomains().map((domain) => `https://${domain}/*`),
);

/** Opt-in AI provider / list-source host permissions (manifest `optional_host_permissions`). */
export const OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS: readonly string[] = [
  ...deriveOptionalDomains().map((domain) => `https://${domain}/*`),
  // Filter-list + metadata sources derive from the LIST_SOURCES SSOT
  // (PBI 2026-09-11-05) — was 6 hardcoded patterns.
  ...ALL_LIST_SOURCES.map((source) => `${source.origin}/*`),
];

/** Local service ports that host_permissions and CSP connect-src must allow. */
export const LOCAL_PORTS = [27123, 27124, 11434, 1234] as const;

/** Hosts that pair with LOCAL_PORTS for local service access. */
const LOCAL_HOSTS = ['127.0.0.1', 'localhost'] as const;

/** Schemes for local service access. */
const LOCAL_SCHEMES = ['http', 'https'] as const;

/**
 * Generates manifest `host_permissions` entries for all local service origins.
 * Produces `schemes × hosts × ports` (2×2×4=16) entries of the form `http://127.0.0.1:27123/*`.
 */
export function buildLocalHostPermissions(): string[] {
  const out: string[] = [];
  for (const scheme of LOCAL_SCHEMES) {
    for (const host of LOCAL_HOSTS) {
      for (const port of LOCAL_PORTS) {
        out.push(`${scheme}://${host}:${port}/*`);
      }
    }
  }
  return out;
}

/**
 * Generates CSP `connect-src` origins for local services.
 * Produces `schemes × hosts × ports` (2×2×4=16) origins without trailing `/*`.
 */
export function buildLocalConnectSrc(): string[] {
  return buildLocalHostPermissions().map((p) => p.replace(/\/\*$/, ''));
}

/**
 * Strips the manifest `/*` suffix from each required + optional host
 * permission, producing the domain list for CSP's connect-src directive.
 */
export function buildConnectSrcDomains(): string[] {
  return [...AI_PROVIDER_HOST_PERMISSIONS, ...OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS].map(
    (perm) => perm.replace(/\/\*$/, '')
  );
}

/**
 * Validates CSP domain list. Throws with descriptive message on first invalid entry.
 * Checks: non-empty, https:// scheme (for AI domains) or http/https for local, no spaces/quotes/semicolons, URL-parseable.
 */
export function validateCspDomains(domains: string[]): void {
  for (const d of domains) {
    if (!d || d.trim() === '') throw new Error(`CSP domain validation failed: empty domain`);
    if (d.includes(' ') || d.includes('\n') || d.includes("'") || d.includes(';')) {
      throw new Error(`CSP domain validation failed: domain contains forbidden char: "${d}"`);
    }
    let url: URL;
    try {
      url = new URL(d);
    } catch {
      throw new Error(`CSP domain validation failed: not a valid URL: "${d}"`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error(`CSP domain validation failed: unsupported scheme in "${d}"`);
    }
  }
}
