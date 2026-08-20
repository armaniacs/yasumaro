/**
 * aiModelKey.ts
 * Shared provider → settings-key resolution for AI model configuration.
 *
 * The mapping from a provider identifier to its model/baseUrl/apiKey settings
 * keys was historically implemented in several places (AIClient.applySlotModel,
 * AIClient.resolveEffectiveModel, OpenAIProvider). A single source prevents the
 * "write key" and "display key" from drifting apart when a provider is added or
 * a key naming convention changes.
 */

import { StorageKeys } from './storage/types.js';

/**
 * Normalize a provider identifier into the snake_case stem used for its
 * settings keys. Examples: openai2 → openai_2, lm-studio → lm_studio.
 */
export function normalizeProviderKeyName(provider: string): string {
    return provider.replace('2', '_2').replace(/-/g, '_').toLowerCase();
}

/**
 * Resolve the settings key holding a provider's model.
 * openai-compatible uses the generic provider_model key; all others use
 * `<normalizedProviderName>_model`.
 */
export function resolveModelKey(provider: string): string {
    if (provider === 'openai-compatible') {
        return StorageKeys.PROVIDER_MODEL;
    }
    return `${normalizeProviderKeyName(provider)}_model`;
}
