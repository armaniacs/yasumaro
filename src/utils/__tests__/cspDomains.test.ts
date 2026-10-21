/**
 * cspDomains.test.ts
 * M24: CSP's connect-src AI-provider domain list must be generated from
 * the same domain constants used by wxt.config.ts's host_permissions /
 * optional_host_permissions, instead of being duplicated as a separate
 * hardcoded string. Adding a new provider domain to the shared array
 * should be enough to update both.
 */
import { describe, it, expect } from 'vitest';
import {
  AI_PROVIDER_HOST_PERMISSIONS,
  OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS,
  GIST_EGRESS_HOST_PERMISSIONS,
  buildConnectSrcDomains,
  buildLocalConnectSrc,
  buildLocalHostPermissions,
  LOCAL_PORTS,
  validateCspDomains,
} from '../cspDomains.js';
import { ALLOWED_LOCALHOST_PORTS } from '../ssrfGuard.js';

describe('buildConnectSrcDomains', () => {
  it('strips the /* suffix from each host permission', () => {
    const domains = buildConnectSrcDomains();
    for (const domain of domains) {
      expect(domain.endsWith('/*')).toBe(false);
    }
  });

  it('includes every required host permission domain', () => {
    const domains = buildConnectSrcDomains();
    for (const perm of AI_PROVIDER_HOST_PERMISSIONS) {
      expect(domains).toContain(perm.replace(/\/\*$/, ''));
    }
  });

  it('includes every optional host permission domain', () => {
    const domains = buildConnectSrcDomains();
    for (const perm of OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS) {
      expect(domains).toContain(perm.replace(/\/\*$/, ''));
    }
  });

  it('includes the Gist egress origin (PBI 2026-10-18-25: the dashboard is an extension page, so its fetch is governed by extension_pages connect-src)', () => {
    const domains = buildConnectSrcDomains();
    for (const perm of GIST_EGRESS_HOST_PERMISSIONS) {
      expect(domains).toContain(perm.replace(/\/\*$/, ''));
    }
  });

  it('produces a space-joined string matching required-then-optional-then-egress order', () => {
    const domains = buildConnectSrcDomains();
    const expectedFirst = AI_PROVIDER_HOST_PERMISSIONS[0].replace(/\/\*$/, '');
    const expectedLast = GIST_EGRESS_HOST_PERMISSIONS[GIST_EGRESS_HOST_PERMISSIONS.length - 1].replace(
      /\/\*$/,
      ''
    );
    expect(domains[0]).toBe(expectedFirst);
    expect(domains[domains.length - 1]).toBe(expectedLast);
  });
});

describe('GIST_EGRESS_HOST_PERMISSIONS', () => {
  it('declares the Gist egress origin as an always-granted host permission', () => {
    expect([...GIST_EGRESS_HOST_PERMISSIONS]).toEqual(['https://api.github.com/*']);
  });

  it('is not folded into the AI provider or opt-in host permission lists', () => {
    // PBI 2026-10-21-11: Gist egress is a separate concept from the
    // browsing-list allowlist — it is neither an AI provider nor a filter-list
    // source, so it must stay its own constant instead of a table row.
    for (const perm of GIST_EGRESS_HOST_PERMISSIONS) {
      expect(AI_PROVIDER_HOST_PERMISSIONS).not.toContain(perm);
      expect(OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS).not.toContain(perm);
    }
  });

  it('passes validateCspDomains (https scheme, URL-parseable)', () => {
    expect(() => validateCspDomains([...GIST_EGRESS_HOST_PERMISSIONS])).not.toThrow();
  });
});

describe('LOCAL_PORTS + buildLocalHostPermissions', () => {
  it('LOCAL_PORTS contains the 4 expected ports', () => {
    expect([...LOCAL_PORTS]).toEqual([27123, 27124, 11434, 1234]);
  });
  it('produces 16 host_permissions (2 schemes × 2 hosts × 4 ports)', () => {
    const perms = buildLocalHostPermissions();
    expect(perms).toHaveLength(16);
    expect(new Set(perms).size).toBe(16);
    for (const p of perms) expect(p.endsWith('/*')).toBe(true);
  });
  it('produces matching 16 connect-src origins without trailing /*', () => {
    const src = buildLocalConnectSrc();
    expect(src).toHaveLength(16);
    for (const o of src) expect(o.endsWith('/*')).toBe(false);
    expect(src).toContain('http://localhost:27123');
    expect(src).toContain('https://127.0.0.1:1234');
  });
  it('host_permissions and connect-src are 1:1 minus trailing slash', () => {
    const perms = buildLocalHostPermissions();
    const src = buildLocalConnectSrc();
    expect(src).toEqual(perms.map((p) => p.replace(/\/\*$/, '')));
  });
  it('buildLocalHostPermissions ports match ALLOWED_LOCALHOST_PORTS (SSOT cross-check)', () => {
    const ports = new Set(buildLocalHostPermissions().map((p) => Number(new URL(p).port)));
    expect(ports).toEqual(new Set<number>(ALLOWED_LOCALHOST_PORTS));
  });
});

describe('validateCspDomains', () => {
  it('passes for valid local + AI domains', () => {
    expect(() => validateCspDomains([...buildLocalConnectSrc(), ...buildConnectSrcDomains()])).not.toThrow();
  });
  it('throws for empty string', () => {
    expect(() => validateCspDomains([''])).toThrow(/empty/);
  });
  it('throws for domain with space', () => {
    expect(() => validateCspDomains(['https://evil domain.com'])).toThrow(/forbidden/);
  });
  it('throws for domain with semicolon', () => {
    expect(() => validateCspDomains(['https://evil.com; script'])).toThrow(/forbidden/);
  });
  it('throws for non-URL', () => {
    expect(() => validateCspDomains(['not-a-url'])).toThrow(/valid URL/);
  });
});
