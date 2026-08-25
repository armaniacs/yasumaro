// @layer 1 — ProviderRegistry table (depends on storage/types layer 1; single source of truth for provider wiring)
/**
 * providerRegistry.ts
 * ProviderRegistry: single table that maps ProviderId → storage keys & behavior flags.
 * Adding a new provider requires only one row here; the rest (model key resolution,
 * factory registration, baseUrl defaults, timeout/content-limit branching) derives
 * from this table.
 */

import { StorageKeys } from '../../utils/storage/types.js';
import type { ProviderId } from '../../utils/storage/types.js';

export interface ProviderRegistryEntry {
    readonly baseUrlKey?: string;
    readonly apiKeyKey?: string;
    readonly modelKey: string;
    readonly defaultBaseUrl?: string;
    readonly defaultModel?: string;
    readonly requiresApiKey: boolean;
    readonly isLocal: boolean;
}

export const PROVIDER_REGISTRY: ReadonlyMap<ProviderId, ProviderRegistryEntry> = new Map<ProviderId, ProviderRegistryEntry>([
    [
        'openai',
        {
            baseUrlKey: StorageKeys.OPENAI_BASE_URL,
            apiKeyKey: StorageKeys.OPENAI_API_KEY,
            modelKey: StorageKeys.OPENAI_MODEL,
            defaultBaseUrl: 'https://api.openai.com/v1',
            defaultModel: 'gpt-3.5-turbo',
            requiresApiKey: true,
            isLocal: false,
        },
    ],
    [
        'openai2',
        {
            baseUrlKey: StorageKeys.OPENAI_2_BASE_URL,
            apiKeyKey: StorageKeys.OPENAI_2_API_KEY,
            modelKey: StorageKeys.OPENAI_2_MODEL,
            defaultBaseUrl: 'https://api.openai.com/v1',
            defaultModel: 'gpt-3.5-turbo',
            requiresApiKey: true,
            isLocal: false,
        },
    ],
    [
        'openai-compatible',
        {
            baseUrlKey: StorageKeys.PROVIDER_BASE_URL,
            apiKeyKey: StorageKeys.PROVIDER_API_KEY,
            modelKey: StorageKeys.PROVIDER_MODEL,
            requiresApiKey: true,
            isLocal: false,
        },
    ],
    [
        'lm-studio',
        {
            baseUrlKey: StorageKeys.LM_STUDIO_BASE_URL,
            modelKey: StorageKeys.LM_STUDIO_MODEL,
            defaultBaseUrl: 'http://127.0.0.1:1234/v1',
            requiresApiKey: false,
            isLocal: true,
        },
    ],
    [
        'ollama',
        {
            baseUrlKey: StorageKeys.OLLAMA_BASE_URL,
            modelKey: StorageKeys.OLLAMA_MODEL,
            defaultBaseUrl: 'http://localhost:11434/v1',
            requiresApiKey: false,
            isLocal: true,
        },
    ],
    [
        'gemini',
        {
            apiKeyKey: StorageKeys.GEMINI_API_KEY,
            modelKey: StorageKeys.GEMINI_MODEL,
            requiresApiKey: true,
            isLocal: false,
        },
    ],
    [
        'built-in-ai',
        {
            modelKey: '',
            requiresApiKey: false,
            isLocal: true,
        },
    ],
]);

export function getRegistryEntry(providerId: string): ProviderRegistryEntry | undefined {
    return PROVIDER_REGISTRY.get(providerId as ProviderId);
}

/**
 * Validate a provider baseUrl against SSRF allowlist.
 * Rejects metadata service hosts and private IP ranges; for non-local
 * providers only https is allowed (http only for localhost/127.0.0.1).
 */
export function isAllowedProviderBaseUrl(url: string, isLocal: boolean): boolean {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
        const host = parsed.hostname;
        if (host === '169.254.169.254' || host === 'metadata.google.internal') return false;
        if (/^10\.\d+\.\d+\.\d+$/.test(host) || /^192\.168\.\d+\.\d+$/.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)) return false;
        if (!isLocal && parsed.protocol === 'http:' && host !== '127.0.0.1' && host !== 'localhost') return false;
        return true;
    } catch {
        return false;
    }
}
