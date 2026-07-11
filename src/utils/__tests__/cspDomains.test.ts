/**
 * cspDomains.test.ts
 * M24: CSP's connect-src AI-provider domain list must be generated from
 * the same domain constants used by wxt.config.ts's host_permissions /
 * optional_host_permissions, instead of being duplicated as a separate
 * hardcoded string. Adding a new provider domain to the shared array
 * should be enough to update both.
 */
import { describe, it, expect } from 'vitest';
import { AI_PROVIDER_HOST_PERMISSIONS, OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS, buildConnectSrcDomains } from '../cspDomains.js';

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

  it('produces a space-joined string matching required-then-optional order', () => {
    const domains = buildConnectSrcDomains();
    const expectedFirst = AI_PROVIDER_HOST_PERMISSIONS[0].replace(/\/\*$/, '');
    const expectedLast = OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS[OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS.length - 1].replace(/\/\*$/, '');
    expect(domains[0]).toBe(expectedFirst);
    expect(domains[domains.length - 1]).toBe(expectedLast);
  });
});
