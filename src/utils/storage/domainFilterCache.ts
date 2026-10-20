// @layer 1 — Infrastructure (depends on Layer 0 only)
/**
 * storage/domainFilterCache.ts
 * Domain filter cache used by content scripts (avoids a message round-trip
 * per page load) plus the wildcard matching it relies on.
 * Split out of storage.ts (PBI: storage.ts deepening).
 */

import { StorageKeys } from './types.js';
import type { Settings } from './types.js';
import type { SettingsWriteOptions } from './SettingsRepository.js';
import { matchesDomainPattern, extractHostname } from '../wildcardToRegex.js';
import { DomainFilter } from '../domainFilter/DomainFilter.js';

/**
 * ドメインフィルタキャッシュの有効期限（ミリ秒）
 * Content Script内で使用するため、メッセージ通信を減らす目的
 */
const DOMAIN_FILTER_CACHE_TTL = 5 * 60 * 1000; // 5分

/**
 * ドメインフィルタキャッシュが有効かどうかを判定
 * @param {number} cachedAt - キャッシュ作成時のタイムスタンプ
 * @returns {boolean} 有効な場合true
 */
export function isDomainFilterCacheValid(cachedAt: number): boolean {
    const now = Date.now();
    return (now - cachedAt) < DOMAIN_FILTER_CACHE_TTL && cachedAt > 0;
}

/**
 * ドメインからパスとクエリを削除して正規化
 * @param {string} url - 正規化対象のURL
 * @returns {string | null} 正規化されたURL（失敗時はnull）
 */
export function normalizeDomainUrl(url: string): string | null {
    return extractHostname(url);
}

/**
 * パターンマッチング（ワイルドカード対応）
 * @deprecated Use matchesDomainPattern from wildcardToRegex.js (single shared path, PBI-18).
 */
export function matchesWildcardPattern(domain: string, pattern: string): boolean {
    return matchesDomainPattern(domain, pattern);
}

/**
 * バックグラウンドスクリプトでドメインフィルタキャッシュを更新
 * Delegates to DomainFilter seam so whitelist/blacklist logic lives in one place.
 * @param {Settings} settings - 設定オブジェクト
 */
export async function updateDomainFilterCache(settings: Settings): Promise<void> {
    const filter = new DomainFilter();
    const { cachedDomains, cachedAt, mode } = filter.cache(settings);
    await chrome.storage.local.set({
        [StorageKeys.DOMAIN_FILTER_CACHE]: cachedDomains,
        [StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP]: cachedAt,
        [StorageKeys.DOMAIN_FILTER_MODE]: mode,
    });
}

/**
 * Write a settings delta, then rebuild the content-script domain filter cache
 * from the freshly stored settings. Single seam for "save domain-related
 * settings + refresh cache" — replaces the copy-pasted
 * `setAll(s); updateDomainFilterCache(await getAll())` IIFE.
 * settingsRepository is imported lazily to keep this module's static
 * dependency graph at Layer 0 only (PBI 2026-10-17-17); the write options are
 * forwarded so callers can surface a coalesced CAS conflict
 * (PBI 2026-10-18-12, Scenario 5). The type-only import above is erased at
 * runtime, so the Layer 0 graph is unchanged.
 */
export async function saveSettingsAndRefreshDomainFilterCache(delta: Partial<Settings>, opts?: SettingsWriteOptions): Promise<void> {
    const { settingsRepository } = await import('./SettingsRepository.js');
    // Only forward the options when present: an explicit `undefined` second
    // argument would change the observable write call shape for callers that
    // save without conflict feedback (PBI 2026-10-18-12 keeps their
    // single-argument contract intact).
    if (opts === undefined) {
        await settingsRepository.setAll(delta);
    } else {
        await settingsRepository.setAll(delta, opts);
    }
    await updateDomainFilterCache(await settingsRepository.getAll());
}
