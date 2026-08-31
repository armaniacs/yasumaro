// @layer 1 — ProviderCatalog deep module (data + single seam resolve)
 /**
  * providerCatalog.ts
  * ProviderCatalog: single seam that returns 6 infos (baseUrlKey/apiKeyKey/modelKey/defaultBaseUrl/cspDomain/label)
  * plus behavior flags. Delegates to PROVIDER_REGISTRY for wiring; augments with cspDomain & label
  * so DiagnosticsCollector and cspSettings no longer branch on provider name.
  */

import { PROVIDER_REGISTRY, type ProviderRegistryEntry } from './providerRegistry.js';
import { StorageKeys } from '../../utils/storage/types.js';
import type { ProviderId } from '../../utils/storage/types.js';

export class UnknownProviderError extends Error {
  constructor(public readonly providerId: string) {
    super(`Unknown provider: ${providerId}`);
    this.name = 'UnknownProviderError';
  }
}

export interface ProviderCatalogEntry extends ProviderRegistryEntry {
  readonly cspDomain?: string;
  readonly label: string;
  /** Storage key for per-provider content limit (e.g. openai → OPENAI_CONTENT_CHARS). */
  readonly contentCharsKey?: string;
}

const CSP_DOMAINS: Record<ProviderId, string | undefined> = {
  gemini: 'https://generativelanguage.googleapis.com',
  openai: 'https://api.openai.com',
  openai2: 'https://api.openai.com',
  'lm-studio': 'http://127.0.0.1:1234',
  ollama: 'http://localhost:11434',
  'openai-compatible': undefined,
  'built-in-ai': undefined,
};

const LABELS: Record<ProviderId, string> = {
  gemini: 'gemini',
  openai: 'openai',
  openai2: 'openai2',
  'lm-studio': 'lm-studio',
  ollama: 'ollama',
  'openai-compatible': 'openai-compatible',
  'built-in-ai': 'built-in-ai',
};

const CONTENT_CHARS_KEYS: Record<ProviderId, string | undefined> = {
  gemini: StorageKeys.GEMINI_CONTENT_CHARS,
  openai: StorageKeys.OPENAI_CONTENT_CHARS,
  openai2: StorageKeys.OPENAI_CONTENT_CHARS,
  'lm-studio': undefined,
  ollama: undefined,
  'openai-compatible': StorageKeys.OPENAI_CONTENT_CHARS,
  'built-in-ai': undefined,
};

function buildCatalog(): ReadonlyMap<ProviderId, ProviderCatalogEntry> {
  const m = new Map<ProviderId, ProviderCatalogEntry>();
  for (const [id, entry] of PROVIDER_REGISTRY.entries()) {
    const cspDomain = CSP_DOMAINS[id];
    const contentCharsKey = CONTENT_CHARS_KEYS[id];
    const label = LABELS[id] ?? id;
    const catalogEntry: ProviderCatalogEntry = {
      ...entry,
      label,
      ...(cspDomain !== undefined ? { cspDomain } : {}),
      ...(contentCharsKey !== undefined ? { contentCharsKey } : {}),
    };
    m.set(id, catalogEntry);
  }
  return m;
}

export const PROVIDER_CATALOG: ReadonlyMap<ProviderId, ProviderCatalogEntry> = buildCatalog();

export function resolveCatalogEntry(providerId: string): ProviderCatalogEntry {
  const entry = PROVIDER_CATALOG.get(providerId as ProviderId);
  if (!entry) throw new UnknownProviderError(providerId);
  return entry;
}

export function tryResolveCatalogEntry(providerId: string): ProviderCatalogEntry | undefined {
  return PROVIDER_CATALOG.get(providerId as ProviderId);
}

/**
 * ProviderCatalog facade — single seam for provider wiring.
 * `resolve(name)` returns the 6 infos required by the PBI plus flags.
 */
export const ProviderCatalog = {
  resolve: resolveCatalogEntry,
  tryResolve: tryResolveCatalogEntry,
  get all(): ReadonlyMap<ProviderId, ProviderCatalogEntry> {
    return PROVIDER_CATALOG;
  },
} as const;
