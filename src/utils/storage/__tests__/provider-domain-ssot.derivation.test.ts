/**
 * provider-domain-ssot.derivation.test.ts (PBI 2026-09-21-13)
 * Comprehensiveness suite: every derived array matches its golden set in both
 * directions, every neutral row is accounted for (unknown-row detection), and
 * a synthetic single-row addition flows into all four derivations.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveConditionalCspEntries,
  deriveOptionalDomains,
  deriveRequiredDomains,
  deriveWhitelistedDomains,
  PROVIDER_ALLOWLIST_ROWS,
  type ProviderAllowlistRow,
} from '../providerAllowlist.js';
import { CSPValidator } from '../../cspValidator.js';
import {
  GOLDEN_DEFAULT_ALLOWED_DOMAINS,
  GOLDEN_OPTIONAL_PERMISSIONS_HEAD,
  GOLDEN_PROVIDER_TO_DOMAIN,
  GOLDEN_REQUIRED_PERMISSIONS,
  GOLDEN_WHITELIST_HEAD,
} from './provider-domain-ssot.golden.test.js';

describe('derivation matches goldens in both directions', () => {
  it('required rows derive exactly the DEFAULT set (order-exact)', () => {
    expect(deriveRequiredDomains()).toEqual(GOLDEN_DEFAULT_ALLOWED_DOMAINS);
  });

  it('required rows derive exactly the manifest host_permissions (order-exact sans wildcard)', () => {
    const withoutWildcard = GOLDEN_REQUIRED_PERMISSIONS.filter((p) => p !== 'https://*.openai.com/*');
    expect(deriveRequiredDomains().map((d) => `https://${d}/*`)).toEqual(withoutWildcard);
  });

  it('optional rows derive exactly the optional permissions head (order-exact)', () => {
    expect(deriveOptionalDomains().map((d) => `https://${d}/*`)).toEqual(GOLDEN_OPTIONAL_PERMISSIONS_HEAD);
  });

  it('conditionalCsp rows derive exactly the PROVIDER_TO_DOMAIN entries (set both ways)', () => {
    const derived = deriveConditionalCspEntries();
    expect(new Set(derived.map((e) => `${e.id}=${e.domain}`))).toEqual(
      new Set(GOLDEN_PROVIDER_TO_DOMAIN.map(([id, domain]) => `${id}=${domain}`)),
    );
  });

  it('whitelist derivation covers exactly the whitelist head set (both ways)', () => {
    expect(new Set(deriveWhitelistedDomains())).toEqual(new Set(GOLDEN_WHITELIST_HEAD));
  });
});

describe('unknown-row detection', () => {
  const goldenUnion = new Set([
    ...GOLDEN_DEFAULT_ALLOWED_DOMAINS,
    ...GOLDEN_PROVIDER_TO_DOMAIN.map(([, domain]) => domain),
    ...GOLDEN_WHITELIST_HEAD,
  ]);

  it('every row domain (or alias) is a known golden domain', () => {
    for (const row of PROVIDER_ALLOWLIST_ROWS) {
      for (const domain of [row.domain, ...(row.extraWhitelistDomains ?? [])]) {
        if (domain) expect(goldenUnion.has(domain), `${row.id}: ${domain}`).toBe(true);
      }
    }
  });

  it('every golden domain is produced by some row', () => {
    const derivedUnion = new Set([
      ...deriveRequiredDomains(),
      ...deriveOptionalDomains(),
      ...deriveConditionalCspEntries().map((e) => e.domain),
      ...deriveWhitelistedDomains(),
    ]);
    for (const domain of goldenUnion) {
      expect(derivedUnion.has(domain)).toBe(true);
    }
  });

  it('tiers partition domains: no hostname is both required and optional', () => {
    const required = new Set(deriveRequiredDomains());
    for (const domain of deriveOptionalDomains()) {
      expect(required.has(domain)).toBe(false);
    }
  });

  it('every row id is unique', () => {
    const ids = PROVIDER_ALLOWLIST_ROWS.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('single-row addition flows into all derivations', () => {
  const extra: ProviderAllowlistRow = {
    id: 'example-new',
    isLocal: false,
    label: 'Example New',
    domain: 'api.example-new.test',
    permissionTier: 'optional',
    conditionalCsp: true,
  };
  const rows = [...PROVIDER_ALLOWLIST_ROWS, extra];

  it('new domain appears in optional, whitelist, and conditional-CSP derivations', () => {
    expect(deriveOptionalDomains(rows)).toContain('api.example-new.test');
    expect(deriveWhitelistedDomains(rows)).toContain('api.example-new.test');
    expect(deriveConditionalCspEntries(rows).map((e) => e.id)).toContain('example-new');
    expect(deriveRequiredDomains(rows)).not.toContain('api.example-new.test');
  });
});

describe('fail-close semantics preserved', () => {
  it('blocks unregistered domains, allows derived ones', () => {
    CSPValidator.reset();
    expect(CSPValidator.isUrlAllowed('https://evil.example/unregistered')).toBe(false);
    for (const domain of deriveRequiredDomains()) {
      expect(CSPValidator.isUrlAllowed(`https://${domain}/v1/x`)).toBe(true);
    }
  });
});
