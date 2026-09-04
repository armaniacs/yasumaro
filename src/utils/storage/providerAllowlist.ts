// @layer 1 — Provider allowlist: neutral descriptor table + pure predicate
/**
 * providerAllowlist.ts — the single source of truth for provider allowlist
 * data (which base-URL setting key belongs to which provider, local or not).
 *
 * This module lives at the low tier on purpose: cspValidator and urlWhitelist
 * both need these rows, and importing them from background/ai/providerCatalog
 * inverted the layer direction (utils -> background) and forced the template
 * flow in ProviderStrategy into lazy dynamic imports. background/ai keeps its
 * full catalog (construction + UI data) but spreads these rows so the data
 * cannot drift.
 */

import { StorageKeys, type StorageKey } from './types.js';

/** Allow-relevant subset of a catalog row. No construction or UI data. */
export interface ProviderAllowlistRow {
  readonly id: string;
  readonly baseUrlKey?: StorageKey | undefined;
  readonly isLocal: boolean;
  readonly label: string;
}

/**
 * Neutral rows, mirroring background/ai/providerCatalog (which spreads them).
 * Insertion order matches the catalog dropdown order.
 */
export const PROVIDER_ALLOWLIST_ROWS: ReadonlyArray<ProviderAllowlistRow> = [
  // gemini has no baseUrlKey (fixed endpoint) — readers skip it, as before.
  { id: 'gemini', isLocal: false, label: 'Google Gemini' },
  { id: 'openai', baseUrlKey: StorageKeys.OPENAI_BASE_URL, isLocal: false, label: 'OpenAI Compatible' },
  { id: 'openai2', baseUrlKey: StorageKeys.OPENAI_2_BASE_URL, isLocal: false, label: 'OpenAI Compatible 2' },
  {
    id: 'lm-studio',
    baseUrlKey: StorageKeys.LM_STUDIO_BASE_URL,
    isLocal: true,
    label: 'LM Studio',
  },
  {
    id: 'ollama',
    baseUrlKey: StorageKeys.OLLAMA_BASE_URL,
    isLocal: true,
    label: 'Ollama',
  },
  {
    id: 'openai-compatible',
    baseUrlKey: StorageKeys.PROVIDER_BASE_URL,
    isLocal: false,
    label: 'OpenAI Compatible',
  },
  // built-in-ai has no baseUrlKey (on-device) — readers skip it, as before.
  { id: 'built-in-ai', isLocal: true, label: 'Built-in AI' },
];

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
