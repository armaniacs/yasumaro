/**
 * providerAllowlist.test.ts
 * The neutral table is the SSOT for allow-relevant fields: every catalog row
 * carrying a baseUrlKey must have a matching table row (and vice versa), so
 * drift fails loudly instead of silently.
 */
import { describe, it, expect } from 'vitest';
import { PROVIDER_ALLOWLIST_ROWS, isAllowedProviderBaseUrl } from '../providerAllowlist.js';
import { PROVIDER_CATALOG } from '../../../background/ai/providerCatalog.js';

describe('PROVIDER_ALLOWLIST_ROWS', () => {
  it('covers exactly the catalog rows (no drift either way)', () => {
    const tableIds = new Set(PROVIDER_ALLOWLIST_ROWS.map((r) => r.id));
    const catalogIds = new Set(PROVIDER_CATALOG.keys());
    expect(tableIds).toEqual(catalogIds);
  });

  it('matches baseUrlKey/isLocal/label per row', () => {
    for (const row of PROVIDER_ALLOWLIST_ROWS) {
      const entry = PROVIDER_CATALOG.get(row.id as never);
      expect(entry).toBeDefined();
      expect(entry?.baseUrlKey ?? undefined).toBe(row.baseUrlKey ?? undefined);
      expect(entry?.isLocal).toBe(row.isLocal);
      expect(entry?.label).toBe(row.label);
    }
  });
});

describe('isAllowedProviderBaseUrl (moved home)', () => {
  it('allows https remotes and http localhost for local providers', () => {
    expect(isAllowedProviderBaseUrl('https://api.openai.com/v1', false)).toBe(true);
    expect(isAllowedProviderBaseUrl('http://localhost:11434/v1', true)).toBe(true);
  });

  it('blocks private ranges and metadata hosts', () => {
    expect(isAllowedProviderBaseUrl('http://169.254.169.254/', false)).toBe(false);
    expect(isAllowedProviderBaseUrl('http://10.0.0.1/v1', false)).toBe(false);
    expect(isAllowedProviderBaseUrl('http://127.0.0.1:1234/v1', false)).toBe(false);
  });
});
