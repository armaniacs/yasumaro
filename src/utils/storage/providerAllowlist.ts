// @layer 1 — Provider allowlist: neutral descriptor table + pure predicate
/**
 * providerAllowlist.ts — the single source of truth for provider allowlist
 * data (which base-URL setting key belongs to which provider, local or not),
 * and for the display name the UI shows for a provider.
 *
 * This module lives at the low tier on purpose: cspValidator and urlWhitelist
 * both need these rows, and importing them from background/ai/providerCatalog
 * inverted the layer direction (utils -> background) and forced the template
 * flow in ProviderStrategy into lazy dynamic imports. background/ai keeps its
 * full catalog (construction + UI data) but spreads these rows so the data
 * cannot drift.
 *
 * UI code must not reach for background/ai/providerCatalog to name a provider:
 * that module statically imports the provider strategies, so a display-only
 * dependency would pull background wiring into the UI bundle. It reads the same
 * rows through PROVIDER_DISPLAY_METADATA / tryResolveProviderDisplayMetadata
 * below, which expose display metadata and nothing else.
 */

import { StorageKeys, type StorageKey } from './types.js';

/** Always-granted (manifest host_permissions) vs opt-in (optional_host_permissions). */
export type ProviderPermissionTier = 'required' | 'optional';

/** Neutral row: allow-relevant data plus the display name the UI projects. */
export interface ProviderAllowlistRow {
  readonly id: string;
  readonly baseUrlKey?: StorageKey | undefined;
  readonly isLocal: boolean;
  readonly label: string;
  /**
   * i18n key localizing `label`. Declaring it is what makes a row displayable:
   * PROVIDER_DISPLAY_METADATA is derived from the rows that carry one, and
   * providerCatalog spreads the same field into its catalog entry, so the key
   * has exactly one declaration site.
   */
  readonly labelI18nKey?: string | undefined;
  /** Bare hostname of a fixed-endpoint provider (absent for configurable/local rows). */
  readonly domain?: string | undefined;
  readonly permissionTier?: ProviderPermissionTier | undefined;
  /** Listed in the conditional-CSP opt-in table (cspValidator PROVIDER_TO_DOMAIN). */
  readonly conditionalCsp?: boolean | undefined;
  /** Legacy alias hostnames that only the urlWhitelist gate recognizes. */
  readonly extraWhitelistDomains?: readonly string[] | undefined;
  /** Legacy exclusion from the urlWhitelist gate (preserved byte-identical, not fixed here). */
  readonly excludeFromWhitelist?: boolean | undefined;
}

/**
 * Neutral rows, mirroring background/ai/providerCatalog (which spreads them).
 * The 7 catalog rows keep their relative order; fixed-endpoint domain rows
 * (required block in DEFAULT_ALLOWED_DOMAINS order, then the optional block
 * in OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS order) carry the hostname + tier
 * so the 4 hand-listed domain arrays derive from here instead of drifting.
 * The 7 catalog rows additionally carry labelI18nKey, which is what marks them
 * as displayable providers for PROVIDER_DISPLAY_METADATA.
 */
export const PROVIDER_ALLOWLIST_ROWS: ReadonlyArray<ProviderAllowlistRow> = [
  // gemini has no baseUrlKey (fixed endpoint) — readers skip it, as before.
  {
    id: 'gemini',
    isLocal: false,
    label: 'Google Gemini',
    labelI18nKey: 'googleGemini',
    domain: 'generativelanguage.googleapis.com',
    permissionTier: 'required',
  },
  {
    id: 'openai',
    baseUrlKey: StorageKeys.OPENAI_BASE_URL,
    isLocal: false,
    label: 'OpenAI Compatible',
    labelI18nKey: 'openaiCompatible',
    domain: 'api.openai.com',
    permissionTier: 'required',
  },
  {
    id: 'openai2',
    baseUrlKey: StorageKeys.OPENAI_2_BASE_URL,
    isLocal: false,
    label: 'OpenAI Compatible 2',
    labelI18nKey: 'openaiCompatible2',
    domain: 'api.openai.com',
    permissionTier: 'required',
  },
  { id: 'anthropic', isLocal: false, label: 'Anthropic Claude', domain: 'api.anthropic.com', permissionTier: 'required' },
  { id: 'groq', isLocal: false, label: 'Groq', domain: 'api.groq.com', permissionTier: 'required' },
  { id: 'mistral', isLocal: false, label: 'Mistral', domain: 'mistral.ai', permissionTier: 'required' },
  {
    id: 'mistral-api',
    isLocal: false,
    label: 'Mistral API',
    domain: 'api.mistral.ai',
    permissionTier: 'required',
    excludeFromWhitelist: true,
  },
  { id: 'deepseek', isLocal: false, label: 'DeepSeek', domain: 'deepseek.com', permissionTier: 'required' },
  {
    id: 'deepseek-api',
    isLocal: false,
    label: 'DeepSeek API',
    domain: 'api.deepseek.com',
    permissionTier: 'required',
    excludeFromWhitelist: true,
  },
  { id: 'voyage', isLocal: false, label: 'Voyage', domain: 'voyageai.com', permissionTier: 'required' },
  {
    id: 'volcengine',
    isLocal: false,
    label: 'Volcengine',
    domain: 'volcengine.com',
    permissionTier: 'required',
    conditionalCsp: true,
  },
  { id: 'z-ai', isLocal: false, label: 'Z.AI', domain: 'z.ai', permissionTier: 'required', conditionalCsp: true },
  { id: 'wandb', isLocal: false, label: 'Weights & Biases', domain: 'wandb.ai', permissionTier: 'required', conditionalCsp: true },
  {
    id: 'sakura',
    isLocal: false,
    label: 'Sakura Internet AI',
    domain: 'api.ai.sakura.ad.jp',
    permissionTier: 'required',
    conditionalCsp: true,
  },
  {
    id: 'lm-studio',
    baseUrlKey: StorageKeys.LM_STUDIO_BASE_URL,
    isLocal: true,
    label: 'LM Studio',
    labelI18nKey: 'lmStudio',
  },
  {
    id: 'ollama',
    baseUrlKey: StorageKeys.OLLAMA_BASE_URL,
    isLocal: true,
    label: 'Ollama',
    labelI18nKey: 'ollama',
  },
  {
    id: 'openai-compatible',
    baseUrlKey: StorageKeys.PROVIDER_BASE_URL,
    isLocal: false,
    label: 'OpenAI Compatible',
    labelI18nKey: 'openaiCompatibleModelsDev',
  },
  // built-in-ai has no baseUrlKey (on-device) — readers skip it, as before.
  { id: 'built-in-ai', isLocal: true, label: 'Built-in AI', labelI18nKey: 'builtInAi' },
  { id: 'huggingface', isLocal: false, label: 'Hugging Face', domain: 'api-inference.huggingface.co', permissionTier: 'optional', conditionalCsp: true },
  {
    id: 'openrouter',
    isLocal: false,
    label: 'OpenRouter',
    domain: 'api.openrouter.ai',
    permissionTier: 'optional',
    conditionalCsp: true,
    extraWhitelistDomains: ['openrouter.ai'],
  },
  { id: 'deepinfra', isLocal: false, label: 'DeepInfra', domain: 'deepinfra.com', permissionTier: 'optional', conditionalCsp: true },
  { id: 'cerebras', isLocal: false, label: 'Cerebras', domain: 'cerebras.ai', permissionTier: 'optional', conditionalCsp: true },
  { id: 'helicone', isLocal: false, label: 'Helicone', domain: 'ai-gateway.helicone.ai', permissionTier: 'optional', conditionalCsp: true },
  { id: 'publicai', isLocal: false, label: 'Public AI', domain: 'api.publicai.co', permissionTier: 'optional', conditionalCsp: true },
  { id: 'venice', isLocal: false, label: 'Venice', domain: 'api.venice.ai', permissionTier: 'optional', conditionalCsp: true },
  { id: 'scaleway', isLocal: false, label: 'Scaleway', domain: 'api.scaleway.ai', permissionTier: 'optional', conditionalCsp: true },
  { id: 'synthetic', isLocal: false, label: 'Synthetic', domain: 'api.synthetic.new', permissionTier: 'optional', conditionalCsp: true },
  { id: 'stima', isLocal: false, label: 'Stima', domain: 'api.stima.tech', permissionTier: 'optional', conditionalCsp: true },
  { id: 'nano-gpt', isLocal: false, label: 'Nano GPT', domain: 'nano-gpt.com', permissionTier: 'optional', conditionalCsp: true },
  { id: 'poe', isLocal: false, label: 'Poe', domain: 'api.poe.com', permissionTier: 'optional', conditionalCsp: true },
  { id: 'chutes', isLocal: false, label: 'Chutes', domain: 'llm.chutes.ai', permissionTier: 'optional', conditionalCsp: true },
  { id: 'abliteration', isLocal: false, label: 'Abliteration', domain: 'api.abliteration.ai', permissionTier: 'optional', conditionalCsp: true },
  { id: 'llamagate', isLocal: false, label: 'LlamaGate', domain: 'api.llamagate.dev', permissionTier: 'optional', conditionalCsp: true },
  { id: 'gmi', isLocal: false, label: 'GMI', domain: 'api.gmi-serving.com', permissionTier: 'optional', conditionalCsp: true },
  { id: 'sarvam', isLocal: false, label: 'Sarvam', domain: 'api.sarvam.ai', permissionTier: 'optional', conditionalCsp: true },
  { id: 'xiaomimimo', isLocal: false, label: 'Xiaomi MiMo', domain: 'xiaomimimo.com', permissionTier: 'optional', conditionalCsp: true },
  { id: 'nebius', isLocal: false, label: 'Nebius', domain: 'nebius.com', permissionTier: 'optional', conditionalCsp: true },
  { id: 'sambanova', isLocal: false, label: 'SambaNova', domain: 'sambanova.ai', permissionTier: 'optional', conditionalCsp: true },
  { id: 'nscale', isLocal: false, label: 'Nscale', domain: 'nscale.com', permissionTier: 'optional', conditionalCsp: true },
  { id: 'featherless', isLocal: false, label: 'Featherless', domain: 'featherless.ai', permissionTier: 'optional', conditionalCsp: true },
  { id: 'galadriel', isLocal: false, label: 'Galadriel', domain: 'galadriel.com', permissionTier: 'optional', conditionalCsp: true },
  { id: 'recraft', isLocal: false, label: 'Recraft', domain: 'recraft.ai', permissionTier: 'optional', conditionalCsp: true },
  { id: 'perplexity', isLocal: false, label: 'Perplexity', domain: 'perplexity.ai', permissionTier: 'optional', conditionalCsp: true },
  { id: 'jina', isLocal: false, label: 'Jina', domain: 'jina.ai', permissionTier: 'optional', conditionalCsp: true },
];

/** First-occurrence dedupe preserving row order (openai/openai2 share a domain). */
function dedupeDomains(domains: string[]): string[] {
  return [...new Set(domains)];
}

/**
 * Pure row → domain derivations (rows param exists so tests can simulate a
 * single-row addition). Consumers derive their arrays from these; adding a
 * provider is one row here.
 */
export function deriveRequiredDomains(rows: ReadonlyArray<ProviderAllowlistRow> = PROVIDER_ALLOWLIST_ROWS): string[] {
  return dedupeDomains(
    rows.filter((row) => row.permissionTier === 'required' && row.domain).map((row) => row.domain as string),
  );
}

export function deriveOptionalDomains(rows: ReadonlyArray<ProviderAllowlistRow> = PROVIDER_ALLOWLIST_ROWS): string[] {
  return dedupeDomains(
    rows.filter((row) => row.permissionTier === 'optional' && row.domain).map((row) => row.domain as string),
  );
}

export function deriveConditionalCspEntries(
  rows: ReadonlyArray<ProviderAllowlistRow> = PROVIDER_ALLOWLIST_ROWS,
): Array<{ id: string; domain: string }> {
  return rows
    .filter((row) => row.conditionalCsp === true && row.domain)
    .map((row) => ({ id: row.id, domain: row.domain as string }));
}

export function deriveWhitelistedDomains(
  rows: ReadonlyArray<ProviderAllowlistRow> = PROVIDER_ALLOWLIST_ROWS,
): string[] {
  return dedupeDomains(
    rows.flatMap((row) => {
      if (!row.domain || row.excludeFromWhitelist === true) return [];
      return [row.domain, ...(row.extraWhitelistDomains ?? [])];
    }),
  );
}

/**
 * Display data a UI surface needs to name a provider: the neutral label plus
 * the i18n key localizing it. Deliberately narrower than a catalog row — no
 * strategy, no storage key, no endpoint — so a view can import it without
 * dragging background wiring into its bundle.
 */
export interface ProviderDisplayMetadata {
  readonly id: string;
  readonly label: string;
  readonly labelI18nKey: string;
}

/**
 * Project the rows that are user-selectable providers (the ones declaring a
 * labelI18nKey). Fixed-endpoint domain rows stay out: they exist for
 * host_permissions / CSP, and admitting them would turn ids the UI never
 * offers into "known" and swallow the unknown-id raw fallback.
 */
export function deriveProviderDisplayMetadata(
  rows: ReadonlyArray<ProviderAllowlistRow> = PROVIDER_ALLOWLIST_ROWS,
): ReadonlyMap<string, ProviderDisplayMetadata> {
  return new Map(
    rows.flatMap((row): Array<readonly [string, ProviderDisplayMetadata]> =>
      row.labelI18nKey === undefined
        ? []
        : [[row.id, { id: row.id, label: row.label, labelI18nKey: row.labelI18nKey }]],
    ),
  );
}

/** Read-only display projection shared by popup, dashboard and the catalog. */
export const PROVIDER_DISPLAY_METADATA: ReadonlyMap<string, ProviderDisplayMetadata> =
  deriveProviderDisplayMetadata();

/**
 * Resolve a provider's display metadata, or undefined when the id is not a
 * known provider. Map-backed, so a provider id naming an Object.prototype
 * member ('constructor', 'toString', …) resolves to undefined and callers keep
 * their raw-id fallback instead of rendering a function source.
 */
export function tryResolveProviderDisplayMetadata(providerId: string): ProviderDisplayMetadata | undefined {
  return PROVIDER_DISPLAY_METADATA.get(providerId);
}

/**
 * Validate a provider baseUrl against SSRF allowlist.
 * Rejects metadata service hosts, private/link-local/loopback ranges,
 * integer/hex-encoded IPv4, and IPv6 variants; for non-local providers
 * only https is allowed (http only for localhost).
 *
 * Moved verbatim from background/ai/providerSecurityPolicy.ts (which keeps a
 * re-export shim). Pure: no imports, no chrome, no storage.
 */
export function isAllowedProviderBaseUrl(url: string, isLocal: boolean): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    // Normalize hostname: lowercase + trailing dot removal (URL.hostname is punycode-resolved but retains trailing dot)
    // Node's URL.hostname includes brackets for IPv6 (e.g. "[::1]"); strip them for checks
    let host = parsed.hostname.toLowerCase().replace(/\.+$/, '').replace(/^\[(.*)\]$/, '$1');
    if (!host) return false;
    // Block metadata service hosts (with and without trailing dot already normalized)
    if (host === '169.254.169.254' || host === 'metadata.google.internal') return false;

    // Helper: check if IPv4 octets fall into private/link-local/loopback
    const isBlockedIPv4 = (octets: number[]): boolean => {
      if (octets.length !== 4) return false;
      const a = octets[0]!;
      const b = octets[1]!;
      const _c = octets[2]!;
      const _d = octets[3]!;
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
      if (octets.every((n) => Number.isFinite(n) && n >= 0 && n <= 255)) {
        // 127.0.0.1 is legitimate localhost for local providers (lm-studio/ollama)
        // but should be blocked for non-local providers
        const is127Loopback = octets[0] === 127 && octets[1] === 0 && octets[2] === 0 && octets[3] === 1;
        if (is127Loopback) {
          if (!isLocal) return false;
        } else {
          if (isBlockedIPv4(octets)) return false;
        }
      }
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
    if (/^0\.\d+\.\d+\.\d+$/.test(host) || /^169\.254\.\d+\.\d+$/.test(host)) return false;


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
 * Why a provider baseUrl origin is (or is not) authorized to carry credentials.
 * Layered on top of isAllowedProviderBaseUrl's deny-only SSRF rules:
 * - 'local': loopback origin (localhost / 127.x / ::1) in a local-provider
 *   slot (lm-studio / ollama / built-in-ai) only. A loopback URL in a
 *   non-local slot falls through to the confirmed check below, so plaintext
 *   credentials to http://localhost can no longer self-authorize outside the
 *   local rows — the dashboard confirmation dialog must explicitly confirm
 *   the origin first.
 * - 'pinned': the row declares a fixed endpoint domain and the URL points at
 *   it (or a subdomain of it).
 * - 'provider-domain': the host is itself a known AI-provider endpoint from
 *   the neutral table (e.g. api.groq.com in an OpenAI-compatible slot).
 * - 'confirmed': the user explicitly confirmed this exact origin for this
 *   slot's baseUrlKey (device-local store; never imported/exported).
 * - 'denied': everything else. A poisoned setting can no longer self-authorize.
 */
export type ProviderOriginAuthorizationReason = 'pinned' | 'confirmed' | 'local' | 'provider-domain' | 'denied';

export interface ProviderOriginAuthorization {
  readonly authorized: boolean;
  readonly reason: ProviderOriginAuthorizationReason;
}

export function isLoopbackOriginHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
  return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/** Every known provider endpoint domain from the neutral table (one set). */
function knownProviderDomains(): Set<string> {
  return new Set(
    PROVIDER_ALLOWLIST_ROWS.flatMap((row) => [
      ...(row.domain ? [row.domain.toLowerCase()] : []),
      ...(row.extraWhitelistDomains ?? []).map((d) => d.toLowerCase()),
    ]),
  );
}

/**
 * Origin-scoped authorization for a provider baseUrl. The loopback exception
 * applies to local-provider slots (lm-studio / ollama / built-in-ai) only and
 * runs after the deny-only SSRF predicate; loopback in a non-local slot must
 * be user-confirmed. The SSRF layer still rejects private / metadata /
 * encoded-IP hosts for everything else.
 */
export function isProviderOriginAuthorized(
  url: string,
  row: ProviderAllowlistRow | undefined,
  confirmedOrigins: ReadonlySet<string>,
): ProviderOriginAuthorization {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { authorized: false, reason: 'denied' };
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, '');
  const loopback = isLoopbackOriginHostname(hostname);
  if (!isAllowedProviderBaseUrl(url, row?.isLocal ?? false)) {
    return { authorized: false, reason: 'denied' };
  }
  if (loopback && (row?.isLocal ?? false)) {
    return { authorized: true, reason: 'local' };
  }
  if (row?.domain) {
    const domain = row.domain.toLowerCase();
    if (hostname === domain || hostname.endsWith('.' + domain)) {
      return { authorized: true, reason: 'pinned' };
    }
  }
  if (knownProviderDomains().has(hostname)) {
    return { authorized: true, reason: 'provider-domain' };
  }
  if (confirmedOrigins.has(parsed.origin)) {
    return { authorized: true, reason: 'confirmed' };
  }
  return { authorized: false, reason: 'denied' };
}

/**
 * Confirmed origins for one baseUrlKey, from the settings blob (sync-readable
 * at provider construction time). Returns an empty set when the key is absent.
 */
export function collectConfirmedOrigins(
  settings: Record<string, unknown>,
  baseUrlKey: string,
): Set<string> {
  const all = settings[StorageKeys.CONFIRMED_PROVIDER_ORIGINS] as Record<string, string[]> | undefined;
  return new Set(all?.[baseUrlKey] ?? []);
}
