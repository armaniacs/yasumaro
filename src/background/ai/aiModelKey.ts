/**
 * aiModelKey.ts (background/ai)
 * Shared provider → settings-key resolution for AI model configuration.
 *
 * Moved here from src/utils/aiModelKey.ts (PBI 2026-09-21-06): the resolver
 * reads the provider catalog, which lives in background/ai, so housing it in
 * utils created a forbidden utils→background static edge and dragged the
 * provider strategy graph through the utils layer. Its only production
 * consumer is RemoteAIService (background), so this is its natural home.
 *
 * The provider catalog (providerCatalog.ts) is the single source of truth:
 * every entry carries its modelKey, so no string-derivation fallback exists.
 * Unknown providers (unreachable via the catalog-driven UI) fall back to the
 * generic PROVIDER_MODEL key — fail-closed rather than guessing a stem.
 */

import { StorageKeys } from '../../utils/storage/types.js';
import { getRegistryEntry } from './providerCatalog.js';

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
