/**
 * aiModelKey.ts
 * Shared provider → settings-key resolution for AI model configuration.
 *
 * Historically this used fragile string-replace ('openai2' → 'openai_2').
 * Now it derives from ProviderRegistry so the single table is the source of truth.
 */

import { StorageKeys } from './storage/types.js';
import { getRegistryEntry } from '../background/ai/providerRegistry.js';

/**
 * Normalize a provider identifier into the snake_case stem used for its
 * settings keys. Examples: openai2 → openai_2, lm-studio → lm_studio.
 *
 * Kept for backward compatibility; registry-backed for known providers.
 */
export function normalizeProviderKeyName(provider: string): string {
    const entry = getRegistryEntry(provider);
    if (entry?.modelKey) {
        // Derive stem by stripping trailing _model — registry is the source
        if (entry.modelKey.endsWith('_model')) {
            return entry.modelKey.slice(0, -6);
        }
    }
    // Fallback for unknown providers preserves legacy behavior
    return provider.replace('2', '_2').replace(/-/g, '_').toLowerCase();
}

/**
 * Resolve the settings key holding a provider's model.
 * openai-compatible uses the generic provider_model key; all others use
 * `<normalizedProviderName>_model`.
 */
export function resolveModelKey(provider: string): string {
    const entry = getRegistryEntry(provider);
    if (entry?.modelKey) {
        return entry.modelKey;
    }
    if (provider === 'openai-compatible') {
        return StorageKeys.PROVIDER_MODEL;
    }
    return `${normalizeProviderKeyName(provider)}_model`;
}
