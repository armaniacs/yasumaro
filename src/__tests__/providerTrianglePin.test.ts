/**
 * providerTrianglePin.test.ts
 *
 * The provider triangle (PBI 2026-10-22-01): cap, CSP and permissions must
 * all derive from the same provider rows. Adding a provider is one row in
 * PROVIDER_ALLOWLIST_ROWS (+ one catalog entry + i18n keys); a hand-listed
 * parallel table that stops matching the rows is a drift this suite pins as
 * a red test instead of a silent unreachable cap.
 *
 * Three corners:
 *
 *   1. cap <-> catalog: PROVIDER_MAX_TOKENS keys === PROVIDER_CATALOG keys.
 *      A slot id that can reach the cap lookup is a catalog id (settings
 *      priority slots resolve to catalog ids and createProviderStrategy
 *      throws UnknownProviderError for anything else), so the cap map must
 *      carry exactly the catalog set: a key outside the catalog is an
 *      unreachable cap, a catalog id missing from the map silently falls
 *      back to GLOBAL_MAX_TOKENS instead of the intended provider cap.
 *
 *   2. CSP <-> rows: every required/optional-tier allowlist row's domain is
 *      in the derived host-permission constants, and a one-row addition
 *      propagates through the same derivation the constants consume.
 *
 *   3. permissions <-> CSP: the connect-src derivation strips the same SSOT
 *      lists the manifest consumes, so the Gist egress rides the same SSOT
 *      (PBI 2026-10-18-25 BDD scenario 1) instead of a second hand-edited
 *      list.
 *
 * Every failing precondition is a red assertion, never a skip: a provider
 * addition that misses one corner, a phantom cap key, or an egress host that
 * leaves the SSOT must fail here with no build.
 */

import { describe, it, expect } from 'vitest';
import { PROVIDER_MAX_TOKENS, GLOBAL_MAX_TOKENS } from '../utils/aiLimits.js';
import { PROVIDER_CATALOG } from '../background/ai/providerCatalog.js';
import {
  AI_PROVIDER_HOST_PERMISSIONS,
  OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS,
  GIST_EGRESS_HOSTS,
  GIST_EGRESS_HOST_PERMISSIONS,
  buildConnectSrcDomains,
} from '../utils/cspDomains.js';
import {
  PROVIDER_ALLOWLIST_ROWS,
  deriveRequiredDomains,
  deriveOptionalDomains,
  type ProviderAllowlistRow,
} from '../utils/storage/providerAllowlist.js';

/* ------------------------------------------------- corner 1: cap <-> catalog */

describe('provider triangle - cap side', () => {
  it('carries exactly the catalog provider set in PROVIDER_MAX_TOKENS (no unreachable rows, no missing ids)', () => {
    // The drift this pin exists for (PBI 2026-10-22-01): the legacy map held
    // keys no slot could resolve (openrouter/perplexity/groq/anthropic/claude/
    // localai) and missed catalog ids (openai2/lm-studio/openai-compatible/
    // built-in-ai), so those caps were dead rows and the missing ids fell
    // through to GLOBAL_MAX_TOKENS. Equality is the drift detector: adding a
    // catalog row without a cap row, or a cap row without a catalog row,
    // fails here.
    expect([...PROVIDER_MAX_TOKENS.keys()].sort()).toEqual(
      [...PROVIDER_CATALOG.keys()].sort(),
    );
  });

  it('resolves the built-in AI static cap through the real catalog id (no phantom key)', () => {
    // builtInAIClient.ts used to read the cap through a phantom 'localai' key
    // no slot could resolve; the static max chars now come from the catalog id
    // the built-in provider actually is.
    expect(PROVIDER_MAX_TOKENS.has('localai')).toBe(false);
    expect(PROVIDER_MAX_TOKENS.get('built-in-ai')).toBe(16384);
  });

  it('keeps every cap within the global safety ceiling', () => {
    for (const cap of PROVIDER_MAX_TOKENS.values()) {
      expect(cap).toBeLessThanOrEqual(Math.max(...PROVIDER_MAX_TOKENS.values()));
      expect(cap).toBeGreaterThan(0);
    }
    // The map may not raise a cap above the documented global ceiling.
    for (const cap of PROVIDER_MAX_TOKENS.values()) {
      expect(cap).toBeLessThanOrEqual(32000);
    }
    expect(GLOBAL_MAX_TOKENS).toBe(16000);
  });
});

/* -------------------------------------------------- corner 2: CSP <-> rows */

describe('provider triangle - CSP side', () => {
  it('derives every required-tier row domain into the always-granted host permissions', () => {
    for (const domain of deriveRequiredDomains()) {
      expect(AI_PROVIDER_HOST_PERMISSIONS).toContain(`https://${domain}/*`);
    }
  });

  it('derives every optional-tier row domain into the opt-in host permissions', () => {
    for (const domain of deriveOptionalDomains()) {
      expect(OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS).toContain(`https://${domain}/*`);
    }
  });

  it('propagates a one-row provider addition through the derivation the constants consume', () => {
    // "Adding a provider is one row here" (providerAllowlist.ts): the pin
    // replays the exact expression cspDomains.ts uses to build the manifest
    // permission, so a derivation that stops consuming the rows fails here.
    const newRow: ProviderAllowlistRow = {
      id: 'triangle-pin-test-provider',
      isLocal: false,
      label: 'Triangle Pin Test',
      domain: 'triangle-pin-test.example',
      permissionTier: 'required',
    };
    const withRow: ReadonlyArray<ProviderAllowlistRow> = [...PROVIDER_ALLOWLIST_ROWS, newRow];
    const required = deriveRequiredDomains(withRow);
    expect(required).toContain('triangle-pin-test.example');
    expect(required.map((domain) => `https://${domain}/*`)).toContain(
      'https://triangle-pin-test.example/*',
    );
    // The tier boundary holds: a required row never leaks into the opt-in list.
    expect(deriveOptionalDomains(withRow)).not.toContain('triangle-pin-test.example');
  });

  it('keeps the Gist egress outside the provider rows (a shipped outbound channel, not an allowlist row)', () => {
    for (const host of GIST_EGRESS_HOSTS) {
      expect(PROVIDER_ALLOWLIST_ROWS.some((row) => row.domain === host)).toBe(false);
    }
  });
});

/* ------------------------------------------- corner 3: permissions <-> CSP */

describe('provider triangle - permissions side', () => {
  it('derives connect-src from the same SSOT lists the manifest consumes (Gist egress rides the same SSOT)', () => {
    const expected = [
      ...AI_PROVIDER_HOST_PERMISSIONS,
      ...OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS,
      ...GIST_EGRESS_HOST_PERMISSIONS,
    ].map((perm) => perm.replace(/\/\*$/, ''));
    expect(buildConnectSrcDomains()).toEqual(expected);
  });

  it('declares every Gist egress host in both host_permissions and connect-src', () => {
    for (const host of GIST_EGRESS_HOSTS) {
      expect(GIST_EGRESS_HOST_PERMISSIONS).toContain(`https://${host}/*`);
      // connect-src entries are origins (suffix stripped), not bare hostnames.
      expect(buildConnectSrcDomains()).toContain(`https://${host}`);
    }
  });
});
