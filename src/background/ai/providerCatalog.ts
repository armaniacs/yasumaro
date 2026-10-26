// @layer 1 — ProviderCatalog deep module (single seam for provider wiring)
// All per-provider data, strategy creation, and SSRF guard live here.
// Adding a provider = one row in PROVIDER_CATALOG + i18n keys.
//
// View-specific fields (cssClass / defaultOpen / extraFields[].a11y) live in
// the derived PROVIDER_VIEW_METADATA map below (PBI 2026-10-14-05), keyed by
// providerId with keys derived from the catalog itself (no parallel id list),
// so a view-only change diffs in the view block, not in the domain rows. All
// view code reads that map; ProviderCatalogEntry carries domain data only
// (the former @deprecated compat fields were removed once every consumer had
// migrated). Revisit only if the catalog grows non-provider concerns.

import { StorageKeys } from '../../utils/storage/types.js';
import type { ProviderId, StorageKey } from '../../utils/storage/types.js';
import type { Settings } from '../../utils/storage/types.js';
import { PROVIDER_ALLOWLIST_ROWS } from '../../utils/storage/providerAllowlist.js';
import { PROVIDER_DEFAULT_BASE_URLS, OPENAI_OFFICIAL_BASE_URL } from '../../utils/storage/providerDefaultBaseUrls.js';
import type { AIProviderStrategy } from './providers/index.js';
import { GeminiProvider, BuiltInAiProvider } from './providers/index.js';
import { GenericOpenAICompatibleProvider } from './providers/OpenAIProvider.js';

export class UnknownProviderError extends Error {
  constructor(public readonly providerId: string) {
    super(`Unknown provider: ${providerId}`);
    this.name = 'UnknownProviderError';
  }
}

export interface ProviderViewExtraFieldA11y {
  readonly describedBy: string;
  readonly noteId: string;
  readonly noteI18nKey: string;
  readonly errorId: string;
}

export interface ProviderViewExtraField {
  readonly storageKey: string;
  readonly inputId: string;
  readonly type: 'text' | 'password';
  readonly labelI18nKey: string;
  readonly placeholder?: string;
  /** Present when the field needs the note/error a11y companion block. */
  readonly a11y?: ProviderViewExtraFieldA11y;
}

/**
 * View-only per-provider metadata. Canonical home is the derived
 * PROVIDER_VIEW_METADATA map below — all view code reads that map
 * (aiProviderCatalogView / providerAccordionView); ProviderCatalogEntry
 * carries no view fields.
 */
export interface ProviderViewMetadata {
  readonly helpI18nKey?: string;
  readonly cssClass?: string;
  readonly defaultOpen?: boolean;
  readonly extraFields?: ReadonlyArray<ProviderViewExtraField>;
}

export interface ProviderCatalogEntry {
  readonly baseUrlKey?: string;
  readonly apiKeyKey?: string;
  readonly modelKey: string;
  readonly defaultBaseUrl?: string;
  readonly defaultModel?: string;
  /** Request dialect is a provider capability, independent of model names. */
  readonly chatCompletionsDialect?: 'openai' | 'openai-compatible';
  /** Read old official-endpoint slots without moving field-bound ciphertext. */
  readonly legacyOpenAIEndpoint?: boolean;
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
  // View-only fields (cssClass / defaultOpen / extraFields) are NOT carried
  // here: they live in PROVIDER_VIEW_METADATA below (removed from this
  // interface once every view consumer had migrated off the @deprecated
  // compat fields).
}

/**
 * Display-relevant fields (baseUrlKey/isLocal/label/labelI18nKey) come from the
 * neutral low-tier table — deriving them here makes drift impossible: a
 * missing row or i18n key throws at module load, and the parity test guards
 * the reverse direction. The same rows back the UI-facing projection
 * (PROVIDER_DISPLAY_METADATA), so the label and its i18n key have one
 * declaration site.
 *
 * Single derivation/verification seam (PBI 2026-10-24-04): every catalog row
 * below is built by defineCatalogEntry, which pulls the allowlist projection,
 * resolves the default base URL from PROVIDER_DEFAULT_BASE_URLS, and verifies
 * the required keys — a gap throws UnknownProviderError at module load
 * instead of shipping a half-wired provider.
 */
export type CatalogEntrySpec = Omit<
  ProviderCatalogEntry,
  'baseUrlKey' | 'isLocal' | 'label' | 'labelI18nKey' | 'defaultBaseUrl'
> & {
  /**
   * Fixed-endpoint default (openai/openai2 only). Local providers omit this
   * and resolve it from PROVIDER_DEFAULT_BASE_URLS inside the seam.
   */
  readonly defaultBaseUrl?: string;
};

/**
 * Build one catalog row from its domain spec (PBI 2026-10-24-04).
 * The allowlist projection and the local default base URL are derived here —
 * the only place that reads them — while required keys are verified:
 * a missing allowlist row, a row without labelI18nKey, requiresApiKey without
 * apiKeyKey, or an absent modelKey throws UnknownProviderError naming the id.
 */
export function defineCatalogEntry(providerId: string, spec: CatalogEntrySpec): ProviderCatalogEntry {
  const row = PROVIDER_ALLOWLIST_ROWS.find((r) => r.id === providerId);
  if (row === undefined || row.labelI18nKey === undefined) throw new UnknownProviderError(providerId);
  if (spec.requiresApiKey && spec.apiKeyKey === undefined) throw new UnknownProviderError(providerId);
  if (spec.modelKey === undefined) throw new UnknownProviderError(providerId);
  const allowlistFields =
    row.baseUrlKey === undefined
      ? { isLocal: row.isLocal, label: row.label, labelI18nKey: row.labelI18nKey }
      : { baseUrlKey: row.baseUrlKey, isLocal: row.isLocal, label: row.label, labelI18nKey: row.labelI18nKey };
  const { defaultBaseUrl: specDefaultBaseUrl, ...domainSpec } = spec;
  const defaultBaseUrl =
    specDefaultBaseUrl ?? (PROVIDER_DEFAULT_BASE_URLS as Readonly<Record<string, string>>)[providerId];
  return {
    ...allowlistFields,
    ...domainSpec,
    ...(defaultBaseUrl === undefined ? {} : { defaultBaseUrl }),
  };
}

// Single definition site for view-only per-provider values (PBI 2026-10-14-05).
// Only gemini carries view values today; every other catalog id resolves to {}
// in the derived map. A view-only change edits this block, never a domain row.
const GEMINI_VIEW_META: ProviderViewMetadata = {
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
};

// Insertion order == the options-page provider dropdown order.
export const PROVIDER_CATALOG: ReadonlyMap<ProviderId, ProviderCatalogEntry> = new Map<ProviderId, ProviderCatalogEntry>([
  [
    'gemini',
    defineCatalogEntry('gemini', {
      apiKeyKey: StorageKeys.GEMINI_API_KEY,
      modelKey: StorageKeys.GEMINI_MODEL,
      requiresApiKey: true,
      cspDomain: 'https://generativelanguage.googleapis.com',
      contentCharsKey: StorageKeys.GEMINI_CONTENT_CHARS,
      fieldPlaceholders: { apiKey: 'geminiApiKeyPlaceholder', model: 'geminiModelPlaceholder' },
      supportsCustomPrompt: true,
      settingsBlockKind: 'generic',
      apiKeyLabelI18nKey: 'geminiApiKey',
      // View-only values (cssClass/defaultOpen/extraFields) deliberately stay
      // OFF this domain row: they are read from PROVIDER_VIEW_METADATA.
    }),
  ],
  [
    'openai-official',
    defineCatalogEntry('openai-official', {
      apiKeyKey: StorageKeys.OPENAI_OFFICIAL_API_KEY,
      modelKey: StorageKeys.OPENAI_OFFICIAL_MODEL,
      defaultBaseUrl: OPENAI_OFFICIAL_BASE_URL,
      defaultModel: 'gpt-6-luna',
      chatCompletionsDialect: 'openai',
      requiresApiKey: true,
      cspDomain: 'https://api.openai.com',
      contentCharsKey: StorageKeys.OPENAI_CONTENT_CHARS,
      fieldPlaceholders: { apiKey: 'openaiApiKeyPlaceholder', model: 'openaiOfficialModelPlaceholder' },
      supportsCustomPrompt: true,
      settingsBlockKind: 'generic',
    }),
  ],
  [
    'openai',
    defineCatalogEntry('openai', {
      chatCompletionsDialect: 'openai-compatible',
      legacyOpenAIEndpoint: true,
      apiKeyKey: StorageKeys.OPENAI_API_KEY,
      modelKey: StorageKeys.OPENAI_MODEL,
      defaultBaseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-3.5-turbo',
      requiresApiKey: true,
      cspDomain: 'https://api.openai.com',
      contentCharsKey: StorageKeys.OPENAI_CONTENT_CHARS,
      fieldPlaceholders: {
        apiKey: 'openaiApiKeyPlaceholder',
        baseUrl: 'openaiBaseUrlPlaceholder',
        model: 'openaiModelPlaceholder',
      },
      supportsCustomPrompt: true,
      settingsBlockKind: 'generic',
    }),
  ],
  [
    'openai2',
    defineCatalogEntry('openai2', {
      chatCompletionsDialect: 'openai-compatible',
      legacyOpenAIEndpoint: true,
      apiKeyKey: StorageKeys.OPENAI_2_API_KEY,
      modelKey: StorageKeys.OPENAI_2_MODEL,
      defaultBaseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-3.5-turbo',
      requiresApiKey: true,
      cspDomain: 'https://api.openai.com',
      contentCharsKey: StorageKeys.OPENAI_CONTENT_CHARS,
      fieldPlaceholders: {
        apiKey: 'openai2ApiKeyPlaceholder',
        baseUrl: 'openai2BaseUrlPlaceholder',
        model: 'openai2ModelPlaceholder',
      },
      supportsCustomPrompt: true,
      settingsBlockKind: 'generic',
    }),
  ],
  [
    'lm-studio',
    defineCatalogEntry('lm-studio', {
      modelKey: StorageKeys.LM_STUDIO_MODEL,
      requiresApiKey: false,
      cspDomain: 'http://127.0.0.1:1234',
      fieldPlaceholders: { baseUrl: 'lmStudioBaseUrlPlaceholder', model: 'lmStudioModelPlaceholder' },
      supportsCustomPrompt: true,
      settingsBlockKind: 'generic',
    }),
  ],
  [
    'ollama',
    defineCatalogEntry('ollama', {
      modelKey: StorageKeys.OLLAMA_MODEL,
      requiresApiKey: false,
      cspDomain: 'http://localhost:11434',
      fieldPlaceholders: { baseUrl: 'ollamaBaseUrlPlaceholder', model: 'ollamaModelPlaceholder' },
      supportsCustomPrompt: true,
      settingsBlockKind: 'generic',
    }),
  ],
  [
    'openai-compatible',
    defineCatalogEntry('openai-compatible', {
      chatCompletionsDialect: 'openai-compatible',
      legacyOpenAIEndpoint: true,
      apiKeyKey: StorageKeys.PROVIDER_API_KEY,
      modelKey: StorageKeys.PROVIDER_MODEL,
      requiresApiKey: true,
      contentCharsKey: StorageKeys.OPENAI_CONTENT_CHARS,
      fieldPlaceholders: {
        apiKey: 'providerApiKeyPlaceholder',
        baseUrl: 'providerBaseUrlPlaceholder',
        model: 'providerModelPlaceholder',
      },
      supportsCustomPrompt: false,
      settingsBlockKind: 'models-dev',
    }),
  ],
  [
    'built-in-ai',
    defineCatalogEntry('built-in-ai', {
      modelKey: '',
      requiresApiKey: false,
      supportsCustomPrompt: true,
      settingsBlockKind: 'built-in-ai',
    }),
  ],
]);


/**
 * Derived view-only metadata, keyed by providerId (PBI 2026-10-14-05).
 * Keys come from PROVIDER_CATALOG itself — there is no parallel id list to
 * drift: adding a catalog row adds a view key automatically ({}
 * unless PROVIDER_VIEW_OVERRIDES names it). All view consumers read this map;
 * ProviderCatalogEntry no longer carries view fields.
 */
const PROVIDER_VIEW_OVERRIDES: Record<string, ProviderViewMetadata> = {
  gemini: GEMINI_VIEW_META,
  'openai-official': { helpI18nKey: 'openaiOfficialHelp' },
};

export const PROVIDER_VIEW_METADATA: ReadonlyMap<ProviderId, ProviderViewMetadata> =
  new Map<ProviderId, ProviderViewMetadata>(
    [...PROVIDER_CATALOG.keys()].map(
      (id): [ProviderId, ProviderViewMetadata] => [id, PROVIDER_VIEW_OVERRIDES[id] ?? {}],
    ),
  );

/**
 * The non-throwing catalog lookup: the table read itself, returning undefined
 * for an id the catalog does not know. This is the only public form of a
 * non-throwing lookup — call sites that want a guaranteed entry use
 * `resolveCatalogEntry`, which throws instead.
 */
export function getRegistryEntry(providerId: string): ProviderCatalogEntry | undefined {
  return PROVIDER_CATALOG.get(providerId as ProviderId);
}

export function resolveCatalogEntry(providerId: string): ProviderCatalogEntry {
  const entry = PROVIDER_CATALOG.get(providerId as ProviderId);
  if (!entry) throw new UnknownProviderError(providerId);
  return entry;
}

export const ProviderCatalog = {
  resolve: resolveCatalogEntry,
  getRegistryEntry,
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

/**
 * Single production seam for strategy creation (PBI 2026-10-16-03).
 * RemoteAIService injects exactly this signature (defaulting to
 * {@link createProviderStrategy}); tests replace the function itself instead
 * of registering fake ids, so a missing catalog row throws
 * UnknownProviderError through the same path production uses.
 */
export type CreateProviderStrategyFn = typeof createProviderStrategy;

/** Register (or override) a protocol factory without touching creation code. */
export function registerProviderFactory(providerId: string, factory: ProviderStrategyFactory): void {
  PROVIDER_STRATEGY_FACTORIES.set(providerId, factory);
}

/** Remove a previously registered factory (restores default resolution).
 *
 * Decision (PBI 2026-10-14-05): kept PUBLIC as a test-only seam. Production
 * grep shows zero callers outside tests — only
 * provider-factory-registry.test.ts uses it to clean up after
 * registerProviderFactory overrides. Forcing tests to poke
 * PROVIDER_STRATEGY_FACTORIES directly would be worse, so the export stays;
 * production code must not call it.
 */
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

