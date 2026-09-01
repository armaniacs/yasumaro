// @layer 1 — ProviderRegistry table (depends on storage/types layer 1; single source of truth for provider wiring)
/**
 * providerRegistry.ts
 * ProviderRegistry: single table that maps ProviderId → storage keys, behavior
 * flags, the CSP origin, the display label, and the per-provider content-limit
 * key. `providerCatalog.ts` is a thin re-export + `resolve()` seam over this.
 * Adding a new provider requires only one row here; the rest (model key
 * resolution, factory registration, baseUrl defaults, timeout/content-limit
 * branching, CSP allow, diagnostics, urlWhitelist) derives from this table.
 *
 * `label` holds a brand name ("Google Gemini"), not localized UI text — the
 * options page renders localized labels from i18n keys, not from here.
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
    /** Brand display name (not localized) — fallback if labelI18nKey resolves to nothing. */
    readonly label: string;
    /** CSP origin to allow when this provider is active; undefined for user-configured / no-network providers. */
    readonly cspDomain?: string;
    /** Storage key for the per-provider send-content char limit. */
    readonly contentCharsKey?: string;
    /** i18n key NAME (stable id, not localized text) for the options-page dropdown label. */
    readonly labelI18nKey: string;
    /** i18n key names for the settings-form input placeholders; only present fields need entries. */
    readonly fieldPlaceholders?: {
        readonly apiKey?: string;
        readonly baseUrl?: string;
        readonly model?: string;
    };
    /** Offered in the custom-prompt "Apply to Provider" select. */
    readonly supportsCustomPrompt: boolean;
    /** How the per-provider settings block renders on the options page. */
    readonly settingsBlockKind?: 'generic' | 'models-dev' | 'built-in-ai';
}

// Insertion order == the options-page provider dropdown order.
export const PROVIDER_REGISTRY: ReadonlyMap<ProviderId, ProviderRegistryEntry> = new Map<ProviderId, ProviderRegistryEntry>([
    [
        'gemini',
        {
            apiKeyKey: StorageKeys.GEMINI_API_KEY,
            modelKey: StorageKeys.GEMINI_MODEL,
            requiresApiKey: true,
            isLocal: false,
            label: 'Google Gemini',
            cspDomain: 'https://generativelanguage.googleapis.com',
            contentCharsKey: StorageKeys.GEMINI_CONTENT_CHARS,
            labelI18nKey: 'googleGemini',
            fieldPlaceholders: { apiKey: 'geminiApiKeyPlaceholder', model: 'geminiModelPlaceholder' },
            supportsCustomPrompt: true,
            settingsBlockKind: 'generic',
        },
    ],
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
            label: 'OpenAI Compatible',
            cspDomain: 'https://api.openai.com',
            contentCharsKey: StorageKeys.OPENAI_CONTENT_CHARS,
            labelI18nKey: 'openaiCompatible',
            fieldPlaceholders: {
                apiKey: 'openaiApiKeyPlaceholder',
                baseUrl: 'openaiBaseUrlPlaceholder',
                model: 'openaiModelPlaceholder',
            },
            supportsCustomPrompt: true,
            settingsBlockKind: 'generic',
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
            label: 'OpenAI Compatible 2',
            cspDomain: 'https://api.openai.com',
            contentCharsKey: StorageKeys.OPENAI_CONTENT_CHARS,
            labelI18nKey: 'openaiCompatible2',
            fieldPlaceholders: {
                apiKey: 'openai2ApiKeyPlaceholder',
                baseUrl: 'openai2BaseUrlPlaceholder',
                model: 'openai2ModelPlaceholder',
            },
            supportsCustomPrompt: true,
            settingsBlockKind: 'generic',
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
            label: 'LM Studio',
            cspDomain: 'http://127.0.0.1:1234',
            labelI18nKey: 'lmStudio',
            fieldPlaceholders: { baseUrl: 'lmStudioBaseUrlPlaceholder', model: 'lmStudioModelPlaceholder' },
            supportsCustomPrompt: true,
            settingsBlockKind: 'generic',
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
            label: 'Ollama',
            cspDomain: 'http://localhost:11434',
            labelI18nKey: 'ollama',
            fieldPlaceholders: { baseUrl: 'ollamaBaseUrlPlaceholder', model: 'ollamaModelPlaceholder' },
            supportsCustomPrompt: true,
            settingsBlockKind: 'generic',
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
            label: 'OpenAI Compatible',
            contentCharsKey: StorageKeys.OPENAI_CONTENT_CHARS,
            labelI18nKey: 'openaiCompatibleModelsDev',
            fieldPlaceholders: {
                apiKey: 'providerApiKeyPlaceholder',
                baseUrl: 'providerBaseUrlPlaceholder',
                model: 'providerModelPlaceholder',
            },
            supportsCustomPrompt: false,
            settingsBlockKind: 'models-dev',
        },
    ],
    [
        'built-in-ai',
        {
            modelKey: '',
            requiresApiKey: false,
            isLocal: true,
            label: 'Built-in AI',
            labelI18nKey: 'builtInAi',
            supportsCustomPrompt: false,
            settingsBlockKind: 'built-in-ai',
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
