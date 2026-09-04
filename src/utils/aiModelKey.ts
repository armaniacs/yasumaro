/**
 * aiModelKey.ts
 * Shared provider → settings-key resolution for AI model configuration.
 *
 * The provider catalog (providerCatalog.ts) is the single source of truth:
 * every entry carries its modelKey, so no string-derivation fallback exists.
 * Unknown providers (unreachable via the catalog-driven UI) fall back to the
 * generic PROVIDER_MODEL key — fail-closed rather than guessing a stem.
 */

import { StorageKeys } from './storage/types.js';
import { getRegistryEntry } from '../background/ai/providerCatalog.js';

/**
 * Resolve the settings key holding a provider's model.
 * Every catalog provider returns its own modelKey; unknown providers fall
 * back to the generic provider_model key.
 */
export function resolveModelKey(provider: string): string {
    const entry = getRegistryEntry(provider);
    if (entry?.modelKey) {
        return entry.modelKey;
    }
    return StorageKeys.PROVIDER_MODEL;
}
