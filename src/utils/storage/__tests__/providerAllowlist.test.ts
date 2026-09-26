/**
 * providerAllowlist.test.ts
 * The neutral table is the SSOT for allow-relevant fields: every catalog row
 * carrying a baseUrlKey must have a matching table row (and vice versa), so
 * drift fails loudly instead of silently. It is also the SSOT for the display
 * metadata the UI projects (see PROVIDER_DISPLAY_METADATA below).
 */
import { describe, it, expect } from 'vitest';
import {
  PROVIDER_ALLOWLIST_ROWS,
  PROVIDER_DISPLAY_METADATA,
  deriveProviderDisplayMetadata,
  isAllowedProviderBaseUrl,
  tryResolveProviderDisplayMetadata,
} from '../providerAllowlist.js';
import { PROVIDER_CATALOG } from '../../../background/ai/providerCatalog.js';

describe('PROVIDER_ALLOWLIST_ROWS', () => {
  it('covers every catalog row (table is a superset: catalog + fixed-endpoint domain rows)', () => {
    const tableIds = new Set(PROVIDER_ALLOWLIST_ROWS.map((r) => r.id));
    for (const catalogId of PROVIDER_CATALOG.keys()) {
      expect(tableIds.has(catalogId)).toBe(true);
    }
  });

  it('matches baseUrlKey/isLocal/label/labelI18nKey per catalog row', () => {
    for (const row of PROVIDER_ALLOWLIST_ROWS) {
      const entry = PROVIDER_CATALOG.get(row.id as never);
      if (!entry) continue;
      expect(entry?.baseUrlKey ?? undefined).toBe(row.baseUrlKey ?? undefined);
      expect(entry?.isLocal).toBe(row.isLocal);
      expect(entry?.label).toBe(row.label);
      expect(entry?.labelI18nKey).toBe(row.labelI18nKey);
    }
  });

  it('every domain row carries a permission tier', () => {
    for (const row of PROVIDER_ALLOWLIST_ROWS) {
      if (row.domain) expect(row.permissionTier).toMatch(/^(required|optional)$/);
    }
  });
});

describe('PROVIDER_DISPLAY_METADATA (read-only UI projection)', () => {
  it('resolves the display label and i18n key of a known provider', () => {
    expect(tryResolveProviderDisplayMetadata('gemini')).toEqual({
      id: 'gemini',
      label: 'Google Gemini',
      labelI18nKey: 'googleGemini',
    });
  });

  it('returns undefined for an unknown provider id', () => {
    expect(tryResolveProviderDisplayMetadata('some-custom-provider')).toBeUndefined();
  });

  it('does not resolve Object.prototype members as providers', () => {
    expect(tryResolveProviderDisplayMetadata('constructor')).toBeUndefined();
    expect(tryResolveProviderDisplayMetadata('toString')).toBeUndefined();
  });

  it('keeps host-permission-only rows out of the UI-known set', () => {
    // Domain rows exist for host_permissions / CSP only. Treating them as
    // displayable providers would silently replace the unknown-id raw
    // fallback for ids the UI never offers.
    expect(PROVIDER_ALLOWLIST_ROWS.length).toBeGreaterThan(PROVIDER_DISPLAY_METADATA.size);
    expect(tryResolveProviderDisplayMetadata('jina')).toBeUndefined();
    expect(tryResolveProviderDisplayMetadata('recraft')).toBeUndefined();
  });

  it('exposes display data only (no strategy or storage wiring)', () => {
    const entry = tryResolveProviderDisplayMetadata('openai');
    expect(Object.keys(entry ?? {}).sort()).toEqual(['id', 'label', 'labelI18nKey']);
  });

  it('derives membership from the row i18n key', () => {
    const rows = [
      { id: 'a', isLocal: false, label: 'A' },
      { id: 'b', isLocal: false, label: 'B', labelI18nKey: 'bKey' },
    ];
    expect([...deriveProviderDisplayMetadata(rows).keys()]).toEqual(['b']);
  });
});

describe('display metadata parity with the provider catalog', () => {
  it('covers exactly the catalog providers', () => {
    // Both directions: a new provider must declare labelI18nKey on its neutral
    // row (so the UI can render it) and the catalog must list the same id.
    expect([...PROVIDER_DISPLAY_METADATA.keys()].sort()).toEqual([...PROVIDER_CATALOG.keys()].sort());
  });

  it('includes exactly the rows that declare a label i18n key', () => {
    const declared = PROVIDER_ALLOWLIST_ROWS.filter((row) => row.labelI18nKey !== undefined);
    expect(PROVIDER_DISPLAY_METADATA.size).toBe(declared.length);
    for (const row of declared) {
      expect(tryResolveProviderDisplayMetadata(row.id)?.labelI18nKey).toBe(row.labelI18nKey);
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
