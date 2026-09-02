// @layer 1 — ProviderRegistry shim (re-export from deep module)
// Compatibility shim: all provider wiring now lives in providerCatalog.ts (deep module).
// New code should import from './providerCatalog.js'.

export {
  PROVIDER_CATALOG as PROVIDER_REGISTRY,
  PROVIDER_CATALOG,
  type ProviderCatalogEntry as ProviderRegistryEntry,
  type ProviderCatalogEntry,
  getRegistryEntry,
  isAllowedProviderBaseUrl,
  createProviderStrategy,
  createStrategy,
  UnknownProviderError,
  resolveCatalogEntry,
  tryResolveCatalogEntry,
  ProviderCatalog,
} from './providerCatalog.js';
