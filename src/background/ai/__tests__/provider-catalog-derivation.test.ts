/**
 * provider-catalog-derivation.test.ts (PBI 2026-10-24-04)
 * Table tests for the single derivation/verification seam defineCatalogEntry:
 * every catalog row derives its allowlist projection and local default base
 * URL through the seam, required keys are verified, and gaps fail explicitly.
 */
import { describe, it, expect } from 'vitest';
import {
  PROVIDER_CATALOG,
  UnknownProviderError,
  defineCatalogEntry,
  type CatalogEntrySpec,
} from '../providerCatalog.js';
import { PROVIDER_ALLOWLIST_ROWS } from '../../../utils/storage/providerAllowlist.js';
import { PROVIDER_DEFAULT_BASE_URLS } from '../../../utils/storage/providerDefaultBaseUrls.js';
import { StorageKeys } from '../../../utils/storage/types.js';

const KNOWN_STORAGE_KEYS = new Set<string>(Object.values(StorageKeys));

/** Domain spec of a catalog row: the entry minus the seam-derived fields. */
function domainSpecOf(providerId: string): CatalogEntrySpec {
  const entry = PROVIDER_CATALOG.get(providerId as never);
  if (!entry) throw new Error(`unknown catalog id in test: ${providerId}`);
  const { baseUrlKey: _baseUrlKey, isLocal: _isLocal, label: _label, labelI18nKey: _labelI18nKey, ...spec } = entry;
  return spec;
}

describe('defineCatalogEntry', () => {
  describe('derives the allowlist projection', () => {
    it.each([...PROVIDER_CATALOG.keys()])('round-trips %s through the seam with no drift', (providerId) => {
      const entry = PROVIDER_CATALOG.get(providerId);
      expect(defineCatalogEntry(providerId, domainSpecOf(providerId))).toEqual(entry);
    });

    it.each([...PROVIDER_CATALOG.keys()])('matches the allowlist row for %s', (providerId) => {
      const row = PROVIDER_ALLOWLIST_ROWS.find((r) => r.id === providerId);
      const entry = PROVIDER_CATALOG.get(providerId);
      expect(row?.baseUrlKey ?? undefined).toBe(entry?.baseUrlKey ?? undefined);
      expect(row?.isLocal).toBe(entry?.isLocal);
      expect(row?.label).toBe(entry?.label);
      expect(row?.labelI18nKey).toBe(entry?.labelI18nKey);
    });
  });

  describe('derives the default base URL', () => {
    it.each(['lm-studio', 'ollama'] as const)('resolves %s from the default-URL table when the spec omits it', (providerId) => {
      const { defaultBaseUrl: _omitted, ...specWithoutDefault } = domainSpecOf(providerId);
      const tableUrl = PROVIDER_DEFAULT_BASE_URLS[providerId];
      expect(defineCatalogEntry(providerId, specWithoutDefault).defaultBaseUrl).toBe(tableUrl);
      expect(PROVIDER_CATALOG.get(providerId)?.defaultBaseUrl).toBe(tableUrl);
    });

    it('keeps the spec-provided fixed-endpoint default for openai/openai2', () => {
      const openaiDefault = PROVIDER_CATALOG.get('openai')?.defaultBaseUrl;
      const openai2Default = PROVIDER_CATALOG.get('openai2')?.defaultBaseUrl;
      expect(openaiDefault).toBeDefined();
      expect(openai2Default).toBe(openaiDefault);
    });

    it.each(['gemini', 'openai-compatible', 'built-in-ai'] as const)('leaves %s without a default base URL', (providerId) => {
      expect(PROVIDER_CATALOG.get(providerId)?.defaultBaseUrl).toBeUndefined();
    });
  });

  describe('verifies the required keys', () => {
    it.each([...PROVIDER_CATALOG.keys()])('%s carries real storage keys', (providerId) => {
      const entry = PROVIDER_CATALOG.get(providerId);
      for (const key of [entry?.baseUrlKey, entry?.apiKeyKey, entry?.contentCharsKey]) {
        if (key !== undefined) expect(KNOWN_STORAGE_KEYS.has(key)).toBe(true);
      }
      if (entry?.modelKey !== '') expect(KNOWN_STORAGE_KEYS.has(entry?.modelKey ?? '')).toBe(true);
      if (entry?.requiresApiKey) expect(entry?.apiKeyKey).toBeDefined();
    });
  });

  describe('fails explicitly on gaps', () => {
    it('throws UnknownProviderError for an id with no allowlist row', () => {
      const spec = domainSpecOf('openai');
      expect(() => defineCatalogEntry('no-such-provider', spec)).toThrow(UnknownProviderError);
    });

    it('throws UnknownProviderError for an allowlist row without a label i18n key', () => {
      const spec = domainSpecOf('openai');
      expect(() => defineCatalogEntry('anthropic', spec)).toThrow(UnknownProviderError);
    });

    it('throws UnknownProviderError when requiresApiKey has no apiKeyKey', () => {
      const { apiKeyKey: _dropped, ...specWithoutKey } = domainSpecOf('openai');
      expect(() => defineCatalogEntry('openai', specWithoutKey)).toThrow(UnknownProviderError);
    });

    it('throws UnknownProviderError when modelKey is absent', () => {
      const { modelKey: _dropped, ...specWithoutModel } = domainSpecOf('ollama');
      expect(() => defineCatalogEntry('ollama', specWithoutModel as CatalogEntrySpec)).toThrow(
        UnknownProviderError,
      );
    });
  });
});
