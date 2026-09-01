// @layer 1 — ProviderCatalog: thin re-export + resolve() seam over ProviderRegistry
/**
 * providerCatalog.ts
 * ProviderCatalog is the single seam for provider wiring lookup. All per-provider
 * data (storage keys, behavior flags, cspDomain, label, contentCharsKey) lives on
 * the ProviderRegistry row; this module only adds the `resolve()` / `tryResolve()`
 * accessors and `UnknownProviderError`, and re-exports the map under the name
 * `PROVIDER_CATALOG` that consumers (cspValidator, cspSettings, DiagnosticsCollector,
 * urlWhitelist) import.
 */

import { PROVIDER_REGISTRY, type ProviderRegistryEntry } from './providerRegistry.js';
import type { ProviderId } from '../../utils/storage/types.js';

export class UnknownProviderError extends Error {
  constructor(public readonly providerId: string) {
    super(`Unknown provider: ${providerId}`);
    this.name = 'UnknownProviderError';
  }
}

export type ProviderCatalogEntry = ProviderRegistryEntry;

export const PROVIDER_CATALOG: ReadonlyMap<ProviderId, ProviderCatalogEntry> = PROVIDER_REGISTRY;

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
 */
export const ProviderCatalog = {
  resolve: resolveCatalogEntry,
  tryResolve: tryResolveCatalogEntry,
  get all(): ReadonlyMap<ProviderId, ProviderCatalogEntry> {
    return PROVIDER_CATALOG;
  },
} as const;
