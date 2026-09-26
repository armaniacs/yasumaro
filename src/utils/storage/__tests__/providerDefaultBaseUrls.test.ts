/**
 * providerDefaultBaseUrls.test.ts
 * Pins the local-provider default-URL SSOT: the catalog rows, DEFAULT_SETTINGS,
 * and the dashboard preset buttons must all derive from PROVIDER_DEFAULT_BASE_URLS
 * so the LM Studio host can never drift again (localhost vs 127.0.0.1).
 */
import { describe, it, expect } from 'vitest';
import { PROVIDER_DEFAULT_BASE_URLS } from '../providerDefaultBaseUrls.js';
import { PROVIDER_CATALOG } from '../../../background/ai/providerCatalog.js';
import { DEFAULT_SETTINGS } from '../defaults.js';
import { StorageKeys } from '../types.js';

describe('PROVIDER_DEFAULT_BASE_URLS — local-provider default URL SSOT', () => {
  it('unifies the LM Studio host on 127.0.0.1', () => {
    expect(PROVIDER_DEFAULT_BASE_URLS['lm-studio']).toBe('http://127.0.0.1:1234/v1');
  });

  it('keeps the Ollama default on localhost', () => {
    expect(PROVIDER_DEFAULT_BASE_URLS['ollama']).toBe('http://localhost:11434/v1');
  });

  it('catalog rows derive their defaultBaseUrl from the table', () => {
    expect(PROVIDER_CATALOG.get('lm-studio')?.defaultBaseUrl).toBe(PROVIDER_DEFAULT_BASE_URLS['lm-studio']);
    expect(PROVIDER_CATALOG.get('ollama')?.defaultBaseUrl).toBe(PROVIDER_DEFAULT_BASE_URLS['ollama']);
  });

  it('DEFAULT_SETTINGS derive the local defaults from the table', () => {
    expect(DEFAULT_SETTINGS[StorageKeys.LM_STUDIO_BASE_URL]).toBe(PROVIDER_DEFAULT_BASE_URLS['lm-studio']);
    expect(DEFAULT_SETTINGS[StorageKeys.OLLAMA_BASE_URL]).toBe(PROVIDER_DEFAULT_BASE_URLS['ollama']);
  });
});
