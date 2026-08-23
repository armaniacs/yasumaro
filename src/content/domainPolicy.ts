/**
 * domainPolicy.ts
 * Content-script-safe domain filter policy.
 * Domain filtering (whitelist / blacklist / uBlock) against the domain filter
 * cache, separated from loader.ts so the injection orchestration stays thin.
 *
 * Pure filtering only — no service worker messaging. StorageKeys come from the
 * single source (storage/types.js) rather than being redefined here, so a
 * filter-spec change lands in one place.
 */

import { StorageKeys } from '../utils/storage/types.js';
import { extractDomain, isDomainInList } from './urlSkipper.js';

// キャッシュ有効期限（5分）
const CACHE_TTL = 5 * 60 * 1000;

export interface DomainCacheCheck {
    allowed: boolean;
    useCache: boolean;
}

/**
 * ドメインフィルタキャッシュから許可チェック
 * @param url - URL
 * @returns {Promise<DomainCacheCheck>}
 *   - allowed: trueで許可、falseで拒否
 *   - useCache: trueでキャッシュ使用、falseでバックグラウンドチェックが必要
 */
export async function checkDomainAllowedFromCache(url: string): Promise<DomainCacheCheck> {
    const domain = extractDomain(url);
    if (!domain) {
        return { allowed: false, useCache: true };
    }

    // キャッシュを非同期取得
    const result = await chrome.storage.local.get([
        StorageKeys.DOMAIN_FILTER_CACHE,
        StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP,
        StorageKeys.DOMAIN_FILTER_MODE
    ]);

    const cachedWhitelist = (result[StorageKeys.DOMAIN_FILTER_CACHE] as string[]) || [];
    const cachedAt = (result[StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP] as number) || 0;
    const mode = (result[StorageKeys.DOMAIN_FILTER_MODE] as string) || 'disabled';

    // キャッシュ有効期限チェック
    const isCacheValid = cachedAt > 0 && (Date.now() - cachedAt) < CACHE_TTL;

    if (!isCacheValid) {
        // キャッシュがない、または期限切れ → バックグラウンドチェックが必要
        return { allowed: false, useCache: false };
    }

    // モード解除: 全ドメイン許可
    if (mode === 'disabled') {
        return { allowed: true, useCache: true };
    }

    // ホワイトリストモード: キャッシュされたホワイトリストに含まれる場合のみ許可
    if (mode === 'whitelist') {
        const allowed = isDomainInList(domain, cachedWhitelist);
        return { allowed, useCache: true };
    }

    // ブラックリストモード: シンプル形式のみチェック可能、uBlock はバックグラウンドへ
    if (mode === 'blacklist') {
        // キャッシュにはホワイトリストデータが入らないため、ブラックリストチェックは別途必要
        // シンプル形式のブラックリストチェックのみキャッシュ実装
        const result2 = await chrome.storage.local.get([
            StorageKeys.DOMAIN_BLACKLIST,
            StorageKeys.SIMPLE_FORMAT_ENABLED,
            StorageKeys.UBLOCK_FORMAT_ENABLED
        ]);

        const blacklist = (result2[StorageKeys.DOMAIN_BLACKLIST] as string[]) || [];
        const simpleEnabled = result2[StorageKeys.SIMPLE_FORMAT_ENABLED] !== false;
        const ublockEnabled = result2[StorageKeys.UBLOCK_FORMAT_ENABLED] === true;

        // uBlockが有効な場合、バックグラウンドチェックが必要（複雑なロジックのため）
        if (ublockEnabled) {
            return { allowed: false, useCache: false };
        }

        // シンプル形式のみの場合、即時チェック可能
        if (simpleEnabled) {
            const isBlocked = isDomainInList(domain, blacklist);
            return { allowed: !isBlocked, useCache: true };
        }

        // シンプル形式無効の場合、デフォルト許可
        return { allowed: true, useCache: true };
    }

    return { allowed: true, useCache: true };
}
