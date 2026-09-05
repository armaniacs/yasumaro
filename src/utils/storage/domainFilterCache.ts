// @layer 1 — Infrastructure (depends on Layer 0 only)
/**
 * storage/domainFilterCache.ts
 * Domain filter cache used by content scripts (avoids a message round-trip
 * per page load) plus the wildcard matching it relies on.
 * Split out of storage.ts (PBI: storage.ts deepening).
 */

import { StorageKeys } from './types.js';
import type { Settings } from './types.js';
import { matchesDomainPattern, extractHostname } from '../wildcardToRegex.js';
import { DomainFilter } from '../domainFilter/DomainFilter.js';

/**
 * ドメインフィルタキャッシュの有効期限（ミリ秒）
 * Content Script内で使用するため、メッセージ通信を減らす目的
 */
const DOMAIN_FILTER_CACHE_TTL = 5 * 60 * 1000; // 5分

/**
 * [同期] ドメインフィルタキャッシュを取得
 * Content Scriptから直接呼び出すため、ストレージに同期的アクセスはできませんが
 * chrome.storage.local.get はコールバックで即時取得可能
 * この関数は Content Script で使用します
 *
 * @param {function} callback - キャッシュデータを受け取るコールバック関数
 */
export function getDomainFilterCacheSync(callback: (data: { allowedDomains: string[]; blockedDomains: string[]; cachedAt: number; mode: string }) => void): void {
    chrome.storage.local.get([
        StorageKeys.DOMAIN_FILTER_CACHE,
        StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP,
        StorageKeys.DOMAIN_FILTER_MODE
    ], (result) => {
        const allowedDomains = (result[StorageKeys.DOMAIN_FILTER_CACHE] as string[]) || [];
        const cachedAt = (result[StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP] as number) || 0;
        const mode = (result[StorageKeys.DOMAIN_FILTER_MODE] as string) || 'disabled';

        // ブロックドメインは設定に基づいて動的に算出（シンプル形式のみ）
        // uBlockフォーマットは複雑なため、バックグラウンドでのチェックが必要
        const blockedDomains: string[] = [];

        callback({ allowedDomains, blockedDomains, cachedAt, mode });
    });
}

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
    const cachedDomains = filter.buildCacheDomains(settings);
    const now = Date.now();
    const mode = (settings[StorageKeys.DOMAIN_FILTER_MODE] as string) || 'whitelist';
    await chrome.storage.local.set({
        [StorageKeys.DOMAIN_FILTER_CACHE]: cachedDomains,
        [StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP]: now,
        [StorageKeys.DOMAIN_FILTER_MODE]: mode,
    });
}
