/**
 * domainUtils.ts
 * Utility functions for domain filtering with wildcard support.
 */

import { settingsRepository } from './storage/SettingsRepository.js';
import { StorageKeys } from './storage/types.js';
import { isUrlBlocked } from './ublockMatcher.js';
import { deriveUblockRulesFromSources } from './derivedUblockRules.js';
import type { Source, UblockRules } from './types.js';
import { matchesDomainPattern, isDomainInList as isDomainInListShared, extractHostname } from './wildcardToRegex.js';
import { isValidDomainPattern } from './domainValidator.js';

/**
 * Check if ublockRules object has any rules (supports both old and new formats)
 * @param {any} ublockRules - The uBlock rules object
 * @returns {boolean} - True if there are any rules
 */
function hasUblockRules(ublockRules: unknown): boolean {
    if (!ublockRules || typeof ublockRules !== 'object') return false;

    const r = ublockRules as Record<string, unknown>;
    // New format: blockDomains/exceptionDomains (arrays)
    const hasBlockDomains = Array.isArray(r['blockDomains']) && (r['blockDomains'] as unknown[]).length > 0;
    const hasExceptionDomains = Array.isArray(r['exceptionDomains']) && (r['exceptionDomains'] as unknown[]).length > 0;

    // Old format: blockRules/exceptionRules (object arrays)
    const hasBlockRules = Array.isArray(r['blockRules']) && (r['blockRules'] as unknown[]).length > 0;
    const hasExceptionRules = Array.isArray(r['exceptionRules']) && (r['exceptionRules'] as unknown[]).length > 0;

    return hasBlockDomains || hasExceptionDomains || hasBlockRules || hasExceptionRules;
}

/**
 * PBI 2026-11-06-01: `ublock_rules` は永続化されない導出キャッシュのため、
 * sources 非空時はここで導出する。導出オブジェクトを sources の同一性に
 * 紐づけて保持することで、`ublockMatcher` 側の WeakMap インデックス
 * キャッシュが効き続ける。
 *
 * 健全性の根拠: source 側の書き手 (`sourceManager`) は要素を丸ごと置換
 * (index 代入・push) し、要素内の配列を直接書き換えない。参照が同じ要素は
 * 内容も同じとみなせる。将来の書き手もこの規約を守ること: 要素内
 * `blockDomains` / `exceptionDomains` 配列の直接変更 (push/splice 等) は
 * このメモを陳腐化させるため禁止。`InMemory`/`Chrome` 両ポートは境界で複製するため、
 * 書き込み後の再読込は新しい参照になる。
 */
let cachedDerivedSources: Source[] | null = null;
let cachedDerivedRules: UblockRules | null = null;

function derivedRulesForSources(sources: Source[]): UblockRules {
  const cachedSources = cachedDerivedSources;
  const cachedRules = cachedDerivedRules;
  if (
    cachedSources !== null && cachedRules !== null &&
    cachedSources.length === sources.length &&
    cachedSources.every((source, index) => source === sources[index])
  ) {
    return cachedRules;
  }
  const derived = deriveUblockRulesFromSources(sources);
  cachedDerivedSources = [...sources];
  cachedDerivedRules = derived;
  return derived;
}

/**
 * Extract domain from URL, removing www subdomain
 * @param {string} url - The URL to extract domain from
 * @returns {string|null} - The extracted domain without www, or null if invalid
 */
export function extractDomain(url: string): string | null {
    return extractHostname(url);
}

/**
 * Check if a domain matches a pattern (supports wildcards)
 * @param {string} domain - The domain to check
 * @param {string} pattern - The pattern to match against (supports wildcards)
 * @returns {boolean} - True if the domain matches the pattern
 */
export function matchesPattern(domain: string, pattern: string): boolean {
    return matchesDomainPattern(domain, pattern);
}

/**
 * Check if a domain is in a list (supports wildcards)
 * @param {string} domain - The domain to check
 * @param {string[]} domainList - The list of domains/patterns to check against
 * @param {boolean} matchSubdomains - Subdomain auto-matching toggle (PBI
 *   2026-09-12-03: default OFF keeps exact-match behavior, but the flag must
 *   be honored everywhere the list is evaluated, not only in isDomainAllowed)
 * @returns {boolean} - True if the domain is in the list
 */
export function isDomainInList(domain: string, domainList: string[] | undefined, matchSubdomains = false): boolean {
    return isDomainInListShared(domain, domainList, matchSubdomains);
}

/**
 * Validate domain format
 * @param {any} domain - The domain to validate
 * @returns {boolean} - True if the domain format is valid
 */
export function isValidDomain(domain: unknown): boolean {
    return isValidDomainPattern(domain);
}

/**
 * Check if a URL is allowed based on domain filter settings from storage.
 * @param {string} url - The URL to check
 * @returns {Promise<boolean>} - True if the URL is allowed
 */
export async function isDomainAllowed(url: string): Promise<boolean> {
    const settings = await settingsRepository.getAll();
    const mode = settings[StorageKeys.DOMAIN_FILTER_MODE];

    if (mode === 'disabled') {
        return true;
    }

    const domain = extractDomain(url);
    if (!domain) {
        return false;
    }

    // Subdomain auto-matching toggle (PBI 2026-09-06-06): default OFF for
    // backward compatibility — existing users keep exact-match behavior.
    const matchSubdomains = settings[StorageKeys.DOMAIN_SUBDOMAIN_MATCHING] === true;

    // Simple Domain Filter
    let simpleResult = true;
    const simpleEnabled = settings[StorageKeys.SIMPLE_FORMAT_ENABLED] !== false;

    if (simpleEnabled) {
        const storedWhitelist = settings[StorageKeys.DOMAIN_WHITELIST] || [];
        const storedBlacklist = settings[StorageKeys.DOMAIN_BLACKLIST] || [];

        if (mode === 'whitelist') {
            // Call the shared impl directly — the local isDomainInList wrapper
            // has a 2-arg signature and would drop matchSubdomains.
            simpleResult = isDomainInListShared(domain, storedWhitelist, matchSubdomains);
        } else if (mode === 'blacklist') {
            simpleResult = !isDomainInListShared(domain, storedBlacklist, matchSubdomains);
        }
    }

    // uBlock Filter
    const ublockEnabled = settings[StorageKeys.UBLOCK_FORMAT_ENABLED] === true;
    let ublockBlocked = false;

    if (ublockEnabled) {
        // PBI 2026-11-06-01: 正本は `ublock_sources`。sources 非空時は
        // そこから導出し、格納済み `ublock_rules` (旧二重データの残骸) は
        // 無視する。sources 空のときのみ格納済み rules を使い、rules-only
        // の旧形式ペイロードの読み込み互換を保つ。
        const sources = (settings[StorageKeys.UBLOCK_SOURCES] || []) as Source[];
        const ublockRules = sources.length > 0
          ? derivedRulesForSources(sources)
          : settings[StorageKeys.UBLOCK_RULES];


        if (ublockRules && hasUblockRules(ublockRules)) {
            ublockBlocked = await isUrlBlocked(url, ublockRules, {});

        }
    }

    return simpleResult && !ublockBlocked;
}

/**
 * Parse domain list from textarea content
 * @param {string} text - The textarea content (one domain per line)
 * @returns {string[]} - Array of valid domains
 */
export function parseDomainList(text: string): string[] {
    if (!text) {
        return [];
    }

    return text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
}