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

export type ProviderCatalogEntryAlias = ProviderCatalogEntry;
export const PROVIDER_REGISTRY = PROVIDER_CATALOG;

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

/**
 * Validate a provider baseUrl against SSRF allowlist.
 * Rejects metadata service hosts, private/link-local/loopback ranges,
 * integer/hex-encoded IPv4, and IPv6 variants; for non-local providers
 * only https is allowed (http only for localhost).
 */
export function isAllowedProviderBaseUrl(url: string, isLocal: boolean): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    // Normalize hostname: lowercase + trailing dot removal (URL.hostname is punycode-resolved but retains trailing dot)
    let host = parsed.hostname.toLowerCase().replace(/\.+$/, '');
    if (!host) return false;
    // Block metadata service hosts (with and without trailing dot already normalized)
    if (host === '169.254.169.254' || host === 'metadata.google.internal') return false;

    // Helper: check if IPv4 octets fall into private/link-local/loopback
    const isBlockedIPv4 = (octets: number[]): boolean => {
      if (octets.length !== 4) return false;
      const a = octets[0] as number;
      const b = octets[1] as number;
      // 0.0.0.0/8, 127.0.0.0/8, 10.0.0.0/8, 192.168.0.0/16, 172.16.0.0/12, 169.254.0.0/16
      if (a === 0) return true;
      if (a === 127) return true;
      if (a === 10) return true;
      if (a === 192 && b === 168) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 169 && b === 254) return true;
      return false;
    };

    // Decode integer/hex-encoded IPv4 (e.g. "2130706433", "0x7f000001", "0x7F.0.0.1")
    const decodeNumericIPv4 = (h: string): number[] | null => {
      // Pure decimal integer (e.g. "2130706433")
      if (/^\d+$/.test(h)) {
        try {
          const n = Number(h);
          if (!Number.isFinite(n) || n < 0 || n > 4294967295) return null;
          // Only treat as numeric IP if it looks like an IP bypass (large number)
          // Small numbers like "1" are not IP-like; but "2130706433" is 127.0.0.1
          // We decode any 32-bit integer to be safe
          return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
        } catch { return null; }
      }
      // Hex integer (e.g. "0x7f000001")
      if (/^0x[0-9a-f]+$/i.test(h)) {
        try {
          const n = parseInt(h, 16);
          if (!Number.isFinite(n) || n < 0 || n > 4294967295) return null;
          return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
        } catch { return null; }
      }
      // Dotted hex (e.g. "0x7F.0.0.1" or "0xc0.0xa8.0x01")
      if (h.includes('.') && /0x/i.test(h)) {
        const parts = h.split('.');
        const octets: number[] = [];
        for (const p of parts) {
          let v: number;
          if (/^0x[0-9a-f]+$/i.test(p)) v = parseInt(p, 16);
          else if (/^\d+$/.test(p)) v = parseInt(p, 10);
          else if (/^0[0-7]+$/.test(p)) v = parseInt(p, 8);
          else return null;
          if (!Number.isFinite(v) || v < 0 || v > 255) return null;
          octets.push(v);
        }
        if (octets.length === 4) return octets;
      }
      return null;
    };

    // Check for numeric encoding bypass before regular IPv4 regex
    const numericOctets = decodeNumericIPv4(host);
    if (numericOctets && isBlockedIPv4(numericOctets)) return false;

    // Regular dotted IPv4
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const octets = host.split('.').map((s) => parseInt(s, 10));
      if (octets.every((n) => Number.isFinite(n) && n >= 0 && n <= 255) && isBlockedIPv4(octets)) return false;
    }

    // IPv6 checks (host contains ':')
    if (host.includes(':')) {
      // Normalize: remove zone id if present (e.g. "fe80::1%lo0")
      const v6 = (host.split('%')[0] ?? '') as string;
      // ::1 loopback
      if (v6 === '::1' || v6 === '0:0:0:0:0:0:0:1') return false;
      // ::ffff: IPv4-mapped (e.g. "::ffff:127.0.0.1" or "::ffff:10.0.0.1")
      if (v6.startsWith('::ffff:')) {
        const v4Part = v6.slice(7);
        if (/^\d+\.\d+\.\d+\.\d+$/.test(v4Part)) {
          const octets = v4Part.split('.').map((s) => parseInt(s, 10));
          if (isBlockedIPv4(octets)) return false;
        } else {
          // hex-encoded v4 in mapped address — block conservatively
          return false;
        }
      }
      // fc00::/7 ULA (fc00:: to fdff:ffff:...)
      if (/^f[cd][0-9a-f]*:/i.test(v6)) return false;
      // fe80::/10 link-local
      if (/^fe[89ab][0-9a-f]*:/i.test(v6)) return false;
      // :: (unspecified) — also block
      if (v6 === '::' || v6 === '0:0:0:0:0:0:0:0') return false;
    }

    // Private IPv4 ranges (dotted) — also covers 0.0.0.0/8 etc. if not already caught
    if (/^10\.\d+\.\d+\.\d+$/.test(host) || /^192\.168\.\d+\.\d+$/.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)) return false;
    if (/^0\.\d+\.\d+\.\d+$/.test(host) || /^127\.\d+\.\d+\.\d+$/.test(host) || /^169\.254\.\d+\.\d+$/.test(host)) return false;

    // Protocol check: non-local providers only allow https.
    // For isLocal, http is allowed for any non-blocked host (SSRF already blocks private IPs).
    // For !isLocal, http is only allowed for localhost (127.0.0.1 is already blocked by SSRF).
    if (!isLocal && parsed.protocol === 'http:' && host !== 'localhost') return false;
    return true;
  } catch {
    return false;
  }
}

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

// Backward-compat alias
export const createStrategy = createProviderStrategy;
