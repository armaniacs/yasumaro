// @layer 1 — ProviderCatalog deep module (single seam for provider wiring)
// All per-provider data, strategy creation, and SSRF guard live here.
// Adding a provider = one row in PROVIDER_CATALOG + i18n keys.

import { StorageKeys } from '../../utils/storage/types.js';
import type { ProviderId } from '../../utils/storage/types.js';
import type { Settings } from '../../utils/storage/types.js';
import type { AIProviderStrategy } from './providers/index.js';
import { GeminiProvider, BuiltInAiProvider } from './providers/index.js';
import { GenericOpenAICompatibleProvider } from './providers/OpenAIProvider.js';

export class UnknownProviderError extends Error {
  constructor(public readonly providerId: string) {
    super(`Unknown provider: ${providerId}`);
    this.name = 'UnknownProviderError';
  }
}

export interface ProviderCatalogEntry {
  readonly baseUrlKey?: string;
  readonly apiKeyKey?: string;
  readonly modelKey: string;
  readonly defaultBaseUrl?: string;
  readonly defaultModel?: string;
  readonly requiresApiKey: boolean;
  readonly isLocal: boolean;
  readonly label: string;
  readonly cspDomain?: string;
  readonly contentCharsKey?: string;
  readonly labelI18nKey: string;
  readonly fieldPlaceholders?: {
    readonly apiKey?: string;
    readonly baseUrl?: string;
    readonly model?: string;
  };
  readonly supportsCustomPrompt: boolean;
  readonly settingsBlockKind?: 'generic' | 'models-dev' | 'built-in-ai';
  /** Extra fields beyond baseUrl/apiKey/model (e.g. geminiApiVersion). */
  readonly extraFields?: ReadonlyArray<{
    readonly storageKey: string;
    readonly inputId: string;
    readonly type: 'text' | 'password';
    readonly labelI18nKey: string;
    readonly placeholder?: string;
  }>;
}

// Insertion order == the options-page provider dropdown order.
export const PROVIDER_CATALOG: ReadonlyMap<ProviderId, ProviderCatalogEntry> = new Map<ProviderId, ProviderCatalogEntry>([
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
      extraFields: [
        {
          storageKey: 'gemini_api_version',
          inputId: 'geminiApiVersion',
          type: 'text',
          labelI18nKey: 'label_gemini_api_version',
          placeholder: 'v1beta',
        },
      ],
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


export function getRegistryEntry(providerId: string): ProviderCatalogEntry | undefined {
  return PROVIDER_CATALOG.get(providerId as ProviderId);
}

export function resolveCatalogEntry(providerId: string): ProviderCatalogEntry {
  const entry = PROVIDER_CATALOG.get(providerId as ProviderId);
  if (!entry) throw new UnknownProviderError(providerId);
  return entry;
}

export function tryResolveCatalogEntry(providerId: string): ProviderCatalogEntry | undefined {
  return PROVIDER_CATALOG.get(providerId as ProviderId);
}

export const ProviderCatalog = {
  resolve: resolveCatalogEntry,
  tryResolve: tryResolveCatalogEntry,
  get all(): ReadonlyMap<ProviderId, ProviderCatalogEntry> {
    return PROVIDER_CATALOG;
  },
} as const;

// SSRF guard lives in providerSecurityPolicy.ts — re-exported for backward compat.
export { isAllowedProviderBaseUrl } from './providerSecurityPolicy.js';

/**
 * Single seam for strategy creation — hides the if (gemini) / if (built-in-ai) switch.
 * RemoteAIService and tests should use this instead of branching on providerId.
 */
export function createProviderStrategy(providerId: string, settings: Settings): AIProviderStrategy {
  void resolveCatalogEntry(providerId);
  // Use entry to determine strategy; no caller needs to know the branching.
  if (providerId === 'gemini') {
    return new GeminiProvider(settings);
  }
  if (providerId === 'built-in-ai') {
    return new BuiltInAiProvider(settings);
  }
  return new GenericOpenAICompatibleProvider(settings, providerId);
}

