// @layer 1 — ProviderRegistry shim (re-export from deep module)
// Compatibility shim: all provider wiring now lives in providerCatalog.ts (deep module).
// New code should import from './providerCatalog.js'.

export {
  PROVIDER_CATALOG,
  type ProviderCatalogEntry,
  getRegistryEntry,
  isAllowedProviderBaseUrl,
  createProviderStrategy,
  UnknownProviderError,
  resolveCatalogEntry,
  tryResolveCatalogEntry,
  ProviderCatalog,
} from './providerCatalog.js';
