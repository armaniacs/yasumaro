// @layer 1 — ProviderCatalog deep module (single seam for provider wiring)
// All per-provider data, strategy creation, and SSRF guard live here.
// Adding a provider = one row in PROVIDER_CATALOG + i18n keys.
//
// View-specific fields (cssClass / defaultOpen / extraFields[].a11y) are
// INTENTIONALLY part of this catalog (PBI 2026-09-21-14): they key off the
// provider id, which is this table's domain, and a separate view-policy map
// would re-create a parallel id list. Consequence agreed with checking-team
// (2026-09-22, System Architect Medium): view-only changes will show up as
// catalog diffs — revisit only if the catalog grows non-provider concerns.

import { StorageKeys } from '../../utils/storage/types.js';
import type { ProviderId, StorageKey } from '../../utils/storage/types.js';
import type { Settings } from '../../utils/storage/types.js';
import { PROVIDER_ALLOWLIST_ROWS } from '../../utils/storage/providerAllowlist.js';
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
  readonly contentCharsKey?: StorageKey;
  readonly labelI18nKey: string;
  readonly fieldPlaceholders?: {
    readonly apiKey?: string;
    readonly baseUrl?: string;
    readonly model?: string;
  };
  readonly supportsCustomPrompt: boolean;
  readonly settingsBlockKind?: 'generic' | 'models-dev' | 'built-in-ai';
  /** apiKey label i18n key; the view falls back to 'aiApiKey' when absent. */
  readonly apiKeyLabelI18nKey?: string;
  /**
   * Extra container CSS class; the view falls back to 'openai-settings'.
   * Empty string opts out (gemini renders without it).
   */
  readonly cssClass?: string;
  /** B-layout accordion initial open state; defaults to closed. */
  readonly defaultOpen?: boolean;
  /** Extra fields beyond baseUrl/apiKey/model (e.g. geminiApiVersion). */
  readonly extraFields?: ReadonlyArray<{
    readonly storageKey: string;
    readonly inputId: string;
    readonly type: 'text' | 'password';
    readonly labelI18nKey: string;
    readonly placeholder?: string;
    /** Present when the field needs the note/error a11y companion block. */
    readonly a11y?: {
      readonly describedBy: string;
      readonly noteId: string;
      readonly noteI18nKey: string;
      readonly errorId: string;
    };
  }>;
}

/**
 * Allow-relevant fields (baseUrlKey/isLocal/label) come from the neutral
 * low-tier table — spreading them here makes drift impossible: a missing row
 * throws at module load, and the parity test guards the reverse direction.
 */
function allowRow(id: string): { baseUrlKey?: string; isLocal: boolean; label: string } {
  const row = PROVIDER_ALLOWLIST_ROWS.find((r) => r.id === id);
  if (!row) throw new UnknownProviderError(id);
  return row.baseUrlKey === undefined
    ? { isLocal: row.isLocal, label: row.label }
    : { baseUrlKey: row.baseUrlKey, isLocal: row.isLocal, label: row.label };
}

// Insertion order == the options-page provider dropdown order.
export const PROVIDER_CATALOG: ReadonlyMap<ProviderId, ProviderCatalogEntry> = new Map<ProviderId, ProviderCatalogEntry>([
  [
    'gemini',
    {
      ...allowRow('gemini'),
      apiKeyKey: StorageKeys.GEMINI_API_KEY,
      modelKey: StorageKeys.GEMINI_MODEL,
      requiresApiKey: true,
      cspDomain: 'https://generativelanguage.googleapis.com',
      contentCharsKey: StorageKeys.GEMINI_CONTENT_CHARS,
      labelI18nKey: 'googleGemini',
      fieldPlaceholders: { apiKey: 'geminiApiKeyPlaceholder', model: 'geminiModelPlaceholder' },
      supportsCustomPrompt: true,
      settingsBlockKind: 'generic',
      apiKeyLabelI18nKey: 'geminiApiKey',
      cssClass: '',
      defaultOpen: true,
      extraFields: [
        {
          storageKey: 'gemini_api_version',
          inputId: 'geminiApiVersion',
          type: 'text',
          labelI18nKey: 'label_gemini_api_version',
          placeholder: 'v1beta',
          a11y: {
            describedBy: 'geminiApiVersionNote geminiApiVersionError',
            noteId: 'geminiApiVersionNote',
            noteI18nKey: 'note_gemini_api_version',
            errorId: 'geminiApiVersionError',
          },
        },
      ],
    },
  ],
  [
    'openai',
    {
      ...allowRow('openai'),
      apiKeyKey: StorageKeys.OPENAI_API_KEY,
      modelKey: StorageKeys.OPENAI_MODEL,
      defaultBaseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-3.5-turbo',
      requiresApiKey: true,
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
      ...allowRow('openai2'),
      apiKeyKey: StorageKeys.OPENAI_2_API_KEY,
      modelKey: StorageKeys.OPENAI_2_MODEL,
      defaultBaseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-3.5-turbo',
      requiresApiKey: true,
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
      ...allowRow('lm-studio'),
      modelKey: StorageKeys.LM_STUDIO_MODEL,
      defaultBaseUrl: 'http://127.0.0.1:1234/v1',
      requiresApiKey: false,
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
      ...allowRow('ollama'),
      modelKey: StorageKeys.OLLAMA_MODEL,
      defaultBaseUrl: 'http://localhost:11434/v1',
      requiresApiKey: false,
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
      ...allowRow('openai-compatible'),
      apiKeyKey: StorageKeys.PROVIDER_API_KEY,
      modelKey: StorageKeys.PROVIDER_MODEL,
      requiresApiKey: true,
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
      ...allowRow('built-in-ai'),
      modelKey: '',
      requiresApiKey: false,
      labelI18nKey: 'builtInAi',
      supportsCustomPrompt: true,
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

export type ProviderStrategyFactory = (
  settings: Settings,
  providerId: string,
  entry: ProviderCatalogEntry,
) => AIProviderStrategy;

/**
 * providerId → factory registry next to PROVIDER_CATALOG. Only protocols
 * with dedicated construction register here; the generic OpenAI-compatible
 * ids share defaultProviderFactory below instead of re-listing it per row.
 */
export const PROVIDER_STRATEGY_FACTORIES = new Map<string, ProviderStrategyFactory>([
  [
    'gemini',
    (settings, _providerId, entry) =>
      new GeminiProvider(settings, entry.contentCharsKey ?? StorageKeys.GEMINI_CONTENT_CHARS),
  ],
  ['built-in-ai', (settings) => new BuiltInAiProvider(settings)],
]);

function defaultProviderFactory(settings: Settings, providerId: string, entry: ProviderCatalogEntry): AIProviderStrategy {
  return new GenericOpenAICompatibleProvider(settings, providerId, entry.contentCharsKey);
}

/** Register (or override) a protocol factory without touching creation code. */
export function registerProviderFactory(providerId: string, factory: ProviderStrategyFactory): void {
  PROVIDER_STRATEGY_FACTORIES.set(providerId, factory);
}

/** Remove a previously registered factory (restores default resolution). */
export function unregisterProviderFactory(providerId: string): void {
  PROVIDER_STRATEGY_FACTORIES.delete(providerId);
}

/**
 * Single seam for strategy creation — registry lookup, no providerId switch.
 * RemoteAIService and tests should use this instead of branching on providerId.
 *
 * Resolved catalog entry's contentCharsKey is handed to the provider so the
 * catalog is the SSOT for the truncation-limit key (PBI 2026-09-17-10).
 * Entries without the key (lm-studio/ollama) fall back inside the provider to
 * the legacy key, preserving current behavior. Unknown ids throw before the
 * registry is consulted, so they never mis-construct a generic provider.
 */
export function createProviderStrategy(providerId: string, settings: Settings): AIProviderStrategy {
  const entry = resolveCatalogEntry(providerId);
  const factory = PROVIDER_STRATEGY_FACTORIES.get(providerId) ?? defaultProviderFactory;
  return factory(settings, providerId, entry);
}

