/**
 * storage/domainFilterCache.ts
 * Domain filter cache used by content scripts (avoids a message round-trip
 * per page load) plus the wildcard matching it relies on.
 * Split out of storage.ts (PBI: storage.ts deepening).
 */

import { StorageKeys } from './types.js';
import type { Settings } from './types.js';

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
    try {
        const urlObj = new URL(url);
        let hostname = urlObj.hostname;

        // www. プレフィックスを削除（ドメインマッチングの一貫性）
        if (hostname.startsWith('www.')) {
            hostname = hostname.substring(4);
        }

        return hostname;
    } catch (e) {
        return null;
    }
}

/**
 * パターンマッチング（ワイルドカード対応）
 * Content Scriptで使用するため、パッケージ化
 * @param {string} domain - チェック対象のドメイン
 * @param {string} pattern - パターン（*を含む場合あり）
 * @returns {boolean} 一致する場合true
 */
export function matchesWildcardPattern(domain: string, pattern: string): boolean {
    if (pattern.includes('*')) {
        // ワイルドカードパターンを正規表現に変換
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regexPattern = escaped.replace(/\\\*/g, '.*');
        const regex = new RegExp(`^${regexPattern}$`, 'i');
        return regex.test(domain);
    }
    // 完全一致（大文字小文字区別なし）
    return domain.toLowerCase() === pattern.toLowerCase();
}

/**
 * バックグラウンドスクリプトでドメインフィルタキャッシュを更新
 * @param {Settings} settings - 設定オブジェクト
 */
export async function updateDomainFilterCache(settings: Settings): Promise<void> {
    const mode = settings[StorageKeys.DOMAIN_FILTER_MODE];
    const now = Date.now();

    // モードに応じてキャッシュするドメインを計算
    let cachedDomains: string[] = [];

    if (mode === 'whitelist') {
        const whitelist = (settings[StorageKeys.DOMAIN_WHITELIST] as string[]) || [];
        const simpleEnabled = settings[StorageKeys.SIMPLE_FORMAT_ENABLED] !== false;
        if (simpleEnabled) {
            cachedDomains = whitelist;
        }
        // uBlockフォーマットの算出は複雑で、ここでは単純なシンプル形式のみキャッシュ
    } else if (mode === 'blacklist') {
        const blacklist = (settings[StorageKeys.DOMAIN_BLACKLIST] as string[]) || [];
        const simpleEnabled = settings[StorageKeys.SIMPLE_FORMAT_ENABLED] !== false;
        if (simpleEnabled) {
            // ブラックリストモードでは「許可ドメイン」キャッシュは空
            // 代わりに「ブロックドメイン」をキャッシュ
            // 実装: 別途ブロックドメインキャッシュが必要だが、TTL短縮で対応
            cachedDomains = [];
        }
    }

    await chrome.storage.local.set({
        [StorageKeys.DOMAIN_FILTER_CACHE]: cachedDomains,
        [StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP]: now
    });
}
