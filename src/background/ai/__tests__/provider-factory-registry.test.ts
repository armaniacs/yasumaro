/**
 * provider-factory-registry.test.ts (PBI 2026-09-21-15)
 * Pins createProviderStrategy output types for all 7 catalog ids (written
 * before the if-chain became a registry), then proves registry behavior:
 * default fallback, unknown-id error, and registration without branch edits.
 */
import { describe, it, expect } from 'vitest';
import {
  createProviderStrategy,
  UnknownProviderError,
  PROVIDER_CATALOG,
} from '../providerCatalog.js';
import type { Settings } from '../../../utils/storage/types.js';
import { GeminiProvider, BuiltInAiProvider } from '../providers/index.js';
import { GenericOpenAICompatibleProvider } from '../providers/OpenAIProvider.js';

const SETTINGS = {} as unknown as Settings;

describe('createProviderStrategy type pins (all catalog ids)', () => {
  it('gemini resolves to GeminiProvider', () => {
    expect(createProviderStrategy('gemini', SETTINGS)).toBeInstanceOf(GeminiProvider);
  });

  it('built-in-ai resolves to BuiltInAiProvider', () => {
    expect(createProviderStrategy('built-in-ai', SETTINGS)).toBeInstanceOf(BuiltInAiProvider);
  });

  it.each(['openai', 'openai2', 'lm-studio', 'ollama', 'openai-compatible'] as const)(
    '%s resolves to GenericOpenAICompatibleProvider',
    (id) => {
      expect(createProviderStrategy(id, SETTINGS)).toBeInstanceOf(GenericOpenAICompatibleProvider);
    },
  );

  it('covers exactly the 7 catalog ids', () => {
    expect([...PROVIDER_CATALOG.keys()]).toHaveLength(7);
  });

  it('unknown providerId throws UnknownProviderError (no generic mis-construction)', () => {
    expect(() => createProviderStrategy('no-such-provider', SETTINGS)).toThrow(UnknownProviderError);
  });
});

describe('provider factory registry', () => {
  it('registry holds the 2 special factories; the rest use the generic default', async () => {
    const catalog = await import('../providerCatalog.js');
    expect(catalog.PROVIDER_STRATEGY_FACTORIES.has('gemini')).toBe(true);
    expect(catalog.PROVIDER_STRATEGY_FACTORIES.has('built-in-ai')).toBe(true);
    for (const id of ['openai', 'openai2', 'lm-studio', 'ollama', 'openai-compatible']) {
      expect(catalog.PROVIDER_STRATEGY_FACTORIES.has(id)).toBe(false);
    }
  });

  it('registering a factory changes resolution without touching branches', async () => {
    const catalog = await import('../providerCatalog.js');
    const sentinel = { sentinel: true } as unknown as ReturnType<typeof createProviderStrategy>;
    catalog.registerProviderFactory('openai', () => sentinel);
    try {
      expect(createProviderStrategy('openai', SETTINGS)).toBe(sentinel);
      expect(createProviderStrategy('openai2', SETTINGS)).toBeInstanceOf(GenericOpenAICompatibleProvider);
    } finally {
      catalog.unregisterProviderFactory('openai');
    }
    expect(createProviderStrategy('openai', SETTINGS)).toBeInstanceOf(GenericOpenAICompatibleProvider);
  });

  it('registering for an unknown id still fails at catalog resolve', async () => {
    const catalog = await import('../providerCatalog.js');
    catalog.registerProviderFactory('no-such-provider', () => {
      throw new Error('must not be called');
    });
    try {
      expect(() => createProviderStrategy('no-such-provider', SETTINGS)).toThrow(UnknownProviderError);
    } finally {
      catalog.unregisterProviderFactory('no-such-provider');
    }
  });
});
