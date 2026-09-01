/**
 * providerCatalog.test.ts
 * Conformance test for ProviderCatalog — the "half-wired provider" safety net.
 *
 * Asserts that every ProviderId resolves through the catalog with only real
 * StorageKeys and a well-formed cspDomain/label, so a provider added to the
 * ProviderId union but not fully wired fails here instead of shipping green.
 */

import { describe, it, expect } from 'vitest';
import { PROVIDER_CATALOG, ProviderCatalog, UnknownProviderError } from '../providerCatalog.js';
import { StorageKeys } from '../../../utils/storage/types.js';
import type { ProviderId } from '../../../utils/storage/types.js';
import { getMessage } from '../../../utils/i18n.js';

// The full ProviderId union, spelled out because a union type is not
// runtime-available. If ProviderId changes this list must change with it —
// assertion #2 catches a drift in the other direction.
const ALL_PROVIDER_IDS: ProviderId[] = [
  'gemini',
  'openai',
  'openai2',
  'lm-studio',
  'ollama',
  'openai-compatible',
  'built-in-ai',
];

const KNOWN_STORAGE_KEYS = new Set<string>(Object.values(StorageKeys));

describe('ProviderCatalog conformance', () => {
  it('resolves every ProviderId', () => {
    for (const id of ALL_PROVIDER_IDS) {
      expect(() => ProviderCatalog.resolve(id), id).not.toThrow();
    }
  });

  it('catalog key set equals the ProviderId union', () => {
    expect([...PROVIDER_CATALOG.keys()].sort()).toEqual([...ALL_PROVIDER_IDS].sort());
  });

  it('throws UnknownProviderError for an unknown provider', () => {
    expect(() => ProviderCatalog.resolve('bogus-provider')).toThrow(UnknownProviderError);
    expect(ProviderCatalog.tryResolve('bogus-provider')).toBeUndefined();
  });

  it('every referenced storage key is a real StorageKeys value', () => {
    for (const [id, entry] of PROVIDER_CATALOG) {
      for (const key of [entry.baseUrlKey, entry.apiKeyKey, entry.contentCharsKey]) {
        if (key) expect(KNOWN_STORAGE_KEYS.has(key), `${id}: ${key}`).toBe(true);
      }
      // built-in-ai has modelKey === '' (no model to configure)
      if (entry.modelKey !== '') {
        expect(KNOWN_STORAGE_KEYS.has(entry.modelKey), `${id}: ${entry.modelKey}`).toBe(true);
      }
    }
  });

  it('every entry has a non-empty label', () => {
    for (const [id, entry] of PROVIDER_CATALOG) {
      expect(typeof entry.label, id).toBe('string');
      expect(entry.label.length, id).toBeGreaterThan(0);
    }
  });

  it('cspDomain, when present, is a well-formed http(s) origin', () => {
    for (const [id, entry] of PROVIDER_CATALOG) {
      if (!entry.cspDomain) continue;
      let url: URL | undefined;
      expect(() => { url = new URL(entry.cspDomain!); }, id).not.toThrow();
      expect(['http:', 'https:'], id).toContain(url!.protocol);
    }
  });

  it('requiresApiKey and isLocal are booleans on every entry', () => {
    for (const [id, entry] of PROVIDER_CATALOG) {
      expect(typeof entry.requiresApiKey, id).toBe('boolean');
      expect(typeof entry.isLocal, id).toBe('boolean');
    }
  });

  it('providers with a configurable detail field are exactly the 6 non-built-in ones', () => {
    // This is the derivation diagnosticsPanel.KNOWN_DETAIL_PROVIDERS uses.
    const detailProviders = [...PROVIDER_CATALOG.entries()]
      .filter(([, e]) => Boolean(e.modelKey || e.baseUrlKey || e.apiKeyKey))
      .map(([id]) => id)
      .sort();
    expect(detailProviders).toEqual(
      ['gemini', 'lm-studio', 'ollama', 'openai', 'openai-compatible', 'openai2'].sort(),
    );
  });

  it('the per-provider storage keys the diagnostics collector fetches are catalog-derived', () => {
    const providerKeys = [...PROVIDER_CATALOG.values()]
      .flatMap((e) => [e.baseUrlKey, e.apiKeyKey, e.modelKey].filter((k): k is string => !!k))
      .sort();
    // A superset check: every key must be real; no assertion on the exact set
    // so adding a provider does not force a test edit here.
    for (const key of providerKeys) {
      expect(KNOWN_STORAGE_KEYS.has(key), key).toBe(true);
    }
  });

  // --- 06c UI metadata ---

  it('every entry has a labelI18nKey that resolves to a message', () => {
    for (const [id, entry] of PROVIDER_CATALOG) {
      expect(entry.labelI18nKey, id).toBeTruthy();
      expect(getMessage(entry.labelI18nKey), `${id}: ${entry.labelI18nKey}`).toBeTruthy();
    }
  });

  it('fieldPlaceholders, when present, resolve to messages', () => {
    for (const [id, entry] of PROVIDER_CATALOG) {
      if (!entry.fieldPlaceholders) continue;
      for (const key of Object.values(entry.fieldPlaceholders)) {
        if (key) expect(getMessage(key), `${id}: ${key}`).toBeTruthy();
      }
    }
  });

  it('supportsCustomPrompt is true exactly for gemini/openai/openai2/lm-studio/ollama', () => {
    const yes = [...PROVIDER_CATALOG].filter(([, e]) => e.supportsCustomPrompt).map(([id]) => id).sort();
    expect(yes).toEqual(['gemini', 'lm-studio', 'ollama', 'openai', 'openai2'].sort());
  });

  it('dropdown order is gemini, openai, openai2, lm-studio, ollama, openai-compatible, built-in-ai', () => {
    expect([...PROVIDER_CATALOG.keys()]).toEqual([
      'gemini', 'openai', 'openai2', 'lm-studio', 'ollama', 'openai-compatible', 'built-in-ai',
    ]);
  });

  it('settingsBlockKind is set on every entry', () => {
    for (const [id, entry] of PROVIDER_CATALOG) {
      expect(['generic', 'models-dev', 'built-in-ai'], id).toContain(entry.settingsBlockKind);
    }
  });
});
