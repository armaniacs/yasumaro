/**
 * providerCatalog.test.ts
 * Conformance test for ProviderCatalog — the "half-wired provider" safety net.
 *
 * Asserts that every ProviderId resolves through the catalog with only real
 * StorageKeys and a well-formed cspDomain/label, so a provider added to the
 * ProviderId union but not fully wired fails here instead of shipping green.
 */

import { describe, it, expect } from 'vitest';
import { PROVIDER_CATALOG, ProviderCatalog, UnknownProviderError, isAllowedProviderBaseUrl } from '../providerCatalog.js';
import { StorageKeys } from '../../../utils/storage/types.js';
import type { ProviderId } from '../../../utils/storage/types.js';
import { getMessage } from '../../../utils/i18n.js';
import { GENERAL_SETTINGS_SCHEMA } from '../../../utils/settingsSchemas.js';

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

  it('every provider detail key is bound in GENERAL_SETTINGS_SCHEMA with the right type', () => {
    // The catalog-driven settings-form builder renders inputs for these keys;
    // GENERAL_SETTINGS_SCHEMA must bind each one (password for api keys) or
    // save/load silently drops the field.
    const schemaByKey = new Map(GENERAL_SETTINGS_SCHEMA.map((f) => [f.key as string, f.type]));
    for (const [id, entry] of PROVIDER_CATALOG) {
      if (entry.baseUrlKey) {
        expect(schemaByKey.get(entry.baseUrlKey), `${id}: ${entry.baseUrlKey}`).toBe('text');
      }
      if (entry.apiKeyKey && entry.requiresApiKey) {
        expect(schemaByKey.get(entry.apiKeyKey), `${id}: ${entry.apiKeyKey}`).toBe('password');
      }
      if (entry.modelKey) {
        expect(schemaByKey.get(entry.modelKey), `${id}: ${entry.modelKey}`).toBe('text');
      }
    }
  });
});

describe('isAllowedProviderBaseUrl — SSRF guard', () => {
  // Happy path
  it('allows https url for non-local provider', () => {
    // BDD: Given a non-local provider with a public https endpoint
    //      When isAllowedProviderBaseUrl is called with isLocal=false
    //      Then it returns true
    expect(isAllowedProviderBaseUrl('https://api.openai.com/', false)).toBe(true);
  });

  it('allows https url with path for non-local provider', () => {
    expect(isAllowedProviderBaseUrl('https://api.openai.com/v1', false)).toBe(true);
  });

  // Metadata service
  it('blocks metadata service IP 169.254.169.254', () => {
    expect(isAllowedProviderBaseUrl('http://169.254.169.254/', false)).toBe(false);
    expect(isAllowedProviderBaseUrl('http://169.254.169.254/', true)).toBe(false);
  });

  // Link-local range
  it('blocks link-local range 169.254.0.0/16', () => {
    expect(isAllowedProviderBaseUrl('http://169.254.1.1/', false)).toBe(false);
    expect(isAllowedProviderBaseUrl('http://169.254.0.1/', true)).toBe(false);
  });

  // Loopback range
  it('blocks loopback range 127.0.0.0/8', () => {
    expect(isAllowedProviderBaseUrl('http://127.0.0.2/', false)).toBe(false);
    expect(isAllowedProviderBaseUrl('http://127.0.0.1/', false)).toBe(false);
  });

  // Zero IP
  it('blocks 0.0.0.0/8 range', () => {
    expect(isAllowedProviderBaseUrl('http://0.0.0.0/', false)).toBe(false);
    expect(isAllowedProviderBaseUrl('http://0.0.1.1/', true)).toBe(false);
  });

  // Integer-encoded IPv4: URL parser resolves 2130706433 to 127.0.0.1 (local providers allow it)
  // But non-local providers block http to 127.0.0.1 as well as non-localhost
  it('integer-encoded 127.0.0.1 (2130706433): blocked for non-local, allowed for local', () => {
    expect(isAllowedProviderBaseUrl('http://2130706433/', false)).toBe(false);
    expect(isAllowedProviderBaseUrl('http://2130706433/', true)).toBe(true);
  });
  it('integer-encoded 10.0.0.1 (167772161): URL resolves to private IP, blocked', () => {
    expect(isAllowedProviderBaseUrl('http://167772161/', false)).toBe(false);
  });

  // Hex-encoded IPv4: URL parser resolves 0x7f000001 to 127.0.0.1
  it('hex-encoded 127.0.0.1 (0x7f000001): blocked for non-local, allowed for local', () => {
    expect(isAllowedProviderBaseUrl('http://0x7f000001/', false)).toBe(false);
    expect(isAllowedProviderBaseUrl('http://0x7f000001/', true)).toBe(true);
  });
  it('hex-encoded 10.0.0.1 (0x0a000001): URL resolves to private IP, blocked', () => {
    expect(isAllowedProviderBaseUrl('http://0x0a000001/', false)).toBe(false);
  });

  // IPv6 loopback
  it('blocks IPv6 loopback ::1', () => {
    expect(isAllowedProviderBaseUrl('http://[::1]/', false)).toBe(false);
    expect(isAllowedProviderBaseUrl('http://[::1]/', true)).toBe(false);
  });

  // IPv4-mapped IPv6
  it('blocks IPv4-mapped IPv6 ::ffff:127.0.0.1', () => {
    expect(isAllowedProviderBaseUrl('http://[::ffff:127.0.0.1]/', false)).toBe(false);
    expect(isAllowedProviderBaseUrl('http://[::ffff:127.0.0.1]/', true)).toBe(false);
  });

  // ULA
  it('blocks ULA fc00::/7', () => {
    expect(isAllowedProviderBaseUrl('http://[fc00::1]/', false)).toBe(false);
    expect(isAllowedProviderBaseUrl('http://[fd00::1]/', false)).toBe(false);
  });

  // Private ranges
  it('blocks private range 10.0.0.0/8', () => {
    expect(isAllowedProviderBaseUrl('http://10.0.0.1/', false)).toBe(false);
  });

  it('blocks private range 192.168.0.0/16', () => {
    expect(isAllowedProviderBaseUrl('http://192.168.1.1/', false)).toBe(false);
  });

  it('blocks private range 172.16.0.0/12', () => {
    expect(isAllowedProviderBaseUrl('http://172.16.0.1/', false)).toBe(false);
    expect(isAllowedProviderBaseUrl('http://172.31.255.255/', false)).toBe(false);
  });

  // Trailing dot
  it('blocks metadata host with trailing dot (normalization)', () => {
    expect(isAllowedProviderBaseUrl('http://metadata.google.internal./', false)).toBe(false);
    expect(isAllowedProviderBaseUrl('http://metadata.google.internal./', true)).toBe(false);
  });

  it('blocks metadata host without trailing dot', () => {
    expect(isAllowedProviderBaseUrl('http://metadata.google.internal/', false)).toBe(false);
  });

  // Invalid URL
  it('returns false for invalid URL', () => {
    expect(isAllowedProviderBaseUrl('not-a-url', false)).toBe(false);
    expect(isAllowedProviderBaseUrl('', false)).toBe(false);
  });

  // Non-http protocol
  it('returns false for non-http(s) protocol', () => {
    expect(isAllowedProviderBaseUrl('ftp://example.com/', false)).toBe(false);
    expect(isAllowedProviderBaseUrl('file:///etc/passwd', false)).toBe(false);
  });

  // isLocal=true with localhost
  it('allows http localhost when isLocal=true', () => {
    expect(isAllowedProviderBaseUrl('http://localhost:11434/v1', true)).toBe(true);
    expect(isAllowedProviderBaseUrl('http://localhost:11434/', true)).toBe(true);
  });

  // isLocal=false with http
  it('rejects http for non-local provider (https only)', () => {
    expect(isAllowedProviderBaseUrl('http://api.openai.com/', false)).toBe(false);
  });

  // Additional: https private range still blocked even for isLocal=false (SSRF takes precedence)
  it('blocks https private IPs even though protocol is allowed', () => {
    expect(isAllowedProviderBaseUrl('https://192.168.1.1/', false)).toBe(false);
    expect(isAllowedProviderBaseUrl('https://10.0.0.1/', false)).toBe(false);
  });
});
