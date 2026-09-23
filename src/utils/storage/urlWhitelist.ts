/**
 * storage/urlWhitelist.ts
 * URL whitelist and allowed-URL construction derived from settings.
 * Extracted from settingsStore.ts (PBI-01).
 */

import { normalizeUrl } from '../urlUtils.js';
import { errorMessage } from '../errorUtils.js';
import { StorageKeys } from './types.js';
import { ALL_LIST_SOURCES, FILTER_LIST_SOURCES } from '../listSources.js';
import type { Settings } from './types.js';
import {
  collectConfirmedOrigins,
  deriveRequiredDomains,
  deriveWhitelistedDomains,
  isProviderOriginAuthorized,
  PROVIDER_ALLOWLIST_ROWS,
} from './providerAllowlist.js';

/**
 * Add each configured provider Base URL to `allowedUrls`, gated on the
 * origin-authorization policy (pinned row domain / user-confirmed origin /
 * loopback). Derived from the neutral PROVIDER_ALLOWLIST_ROWS so a new
 * provider's base URL is covered by its table row alone. Local rows are
 * included: their loopback origins (any port) must survive the fail-closed
 * allowlist, and a non-loopback baseUrl in a local slot is denied by the
 * same policy as everywhere else.
 */
export function addProviderBaseUrls(
    allowedUrls: Set<string>,
    settings: Record<string, unknown>,
): void {
    for (const entry of PROVIDER_ALLOWLIST_ROWS) {
        if (!entry.baseUrlKey) continue;
        const rawUrl = settings[entry.baseUrlKey] as string | undefined;
        if (!rawUrl) continue;
        const confirmed = collectConfirmedOrigins(settings, entry.baseUrlKey);
        if (isProviderOriginAuthorized(rawUrl, entry, confirmed).authorized) {
            try {
                allowedUrls.add(normalizeUrl(rawUrl));
            } catch (e) {
                console.warn(`Invalid ${entry.label} Base URL, skipping: ${rawUrl}, error: ${errorMessage(e)}`);
            }
        } else {
            console.warn(`${entry.label} Base URL not authorized, skipped: ${rawUrl}`);
        }
    }
}

export const ALLOWED_AI_PROVIDER_DOMAINS = [
    // Provider hostnames derive from the neutral PROVIDER_ALLOWLIST_ROWS so a
    // new row flows here without a hand edit (set-identical to the legacy
    // list; the legacy interleaved order is documented in the golden test).
    ...deriveWhitelistedDomains(),
    // Filter-list + metadata sources derive from the LIST_SOURCES SSOT
    // (PBI 2026-09-11-05): the gate previously omitted nsfw.oisd.nl while
    // buildAllowedUrls granted its origin — the gate/grant mismatch that
    // warn-skipped OISD ublock sources. Tranco is metadata-only (see
    // listSources.ts) but the gate recognizes it for CSP consistency.
    ...ALL_LIST_SOURCES.map((source) => source.host),
    'localhost',
    '127.0.0.1',
];

export function isDomainInWhitelist(url: string): boolean {
    try {
        const parsedUrl = new URL(url);
        const hostname = parsedUrl.hostname;
        if (ALLOWED_AI_PROVIDER_DOMAINS.includes(hostname)) {
            return true;
        }
        for (const allowedDomain of ALLOWED_AI_PROVIDER_DOMAINS) {
            if (allowedDomain.startsWith('*.')) {
                const domainSuffix = allowedDomain.substring(2);
                if (hostname === domainSuffix || hostname.endsWith('.' + domainSuffix)) {
                    return true;
                }
            }
        }
        return false;
    } catch (_e) {
        return false;
    }
}

export function buildAllowedUrls(settings: Settings): Set<string> {
    const allowedUrls = new Set<string>();
    const protocol = (settings[StorageKeys.OBSIDIAN_PROTOCOL] as string) || 'https';
    const port = (settings[StorageKeys.OBSIDIAN_PORT] as string) || '27124';
    try {
        allowedUrls.add(normalizeUrl(`${protocol}://127.0.0.1:${port}`));
    } catch (e) {
        console.warn(`Invalid Obsidian URL (127.0.0.1), skipping: ${errorMessage(e)}`);
    }
    try {
        allowedUrls.add(normalizeUrl(`${protocol}://localhost:${port}`));
    } catch (e) {
        console.warn(`Invalid Obsidian URL (localhost), skipping: ${errorMessage(e)}`);
    }
    // Pinned fixed-endpoint provider domains are always legitimate targets —
    // they mirror the manifest host_permissions (required tier, gemini's
    // googleapis included). Without these, a provider running on its
    // catalog-default base URL (settings key absent) would be rejected by
    // the fail-closed allowlist reader.
    for (const domain of deriveRequiredDomains()) {
        allowedUrls.add(`https://${domain}`);
    }
    addProviderBaseUrls(allowedUrls, settings as Record<string, unknown>);
    const ublockSources = (settings[StorageKeys.UBLOCK_SOURCES] as Array<{ url?: string }>) || [];
    for (const source of ublockSources) {
        if (source.url && source.url !== 'manual') {
            try {
                const parsed = new URL(source.url);
                // Gate on the whitelist: a stored ublock source must not be able
                // to add an arbitrary origin to the allow list on its own.
                if (isDomainInWhitelist(source.url)) {
                    allowedUrls.add(normalizeUrl(parsed.origin));
                } else {
                    console.warn(`uBlock source origin not in whitelist, skipped: ${parsed.origin}`);
                }
            } catch (_e) {
                // ignore invalid URL
            }
        }
    }
    // Filter-list fetch origins derive from the LIST_SOURCES SSOT
    // (PBI 2026-09-11-05) — was 5 hardcoded origin literals.
    for (const source of FILTER_LIST_SOURCES) {
        allowedUrls.add(source.origin);
    }
    return allowedUrls;
}

export function computeUrlsHash(urls: Set<string>): string {
    const sortedUrls = Array.from(urls).sort();
    return sortedUrls.join('|');
}

export async function getAllowedUrls(): Promise<Set<string>> {
    const result = await chrome.storage.local.get(StorageKeys.ALLOWED_URLS);
    const urls = (result[StorageKeys.ALLOWED_URLS] as string[]) || [];
    return new Set(urls);
}
