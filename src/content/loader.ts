/**
 * loader.ts
 * 【Task #19 最適化】Content Script loader with domain filter cache
 * 動的に extractor モジュールをインポートし、ドメインフィルタをチェックする
 *
 * パフォーマンス改善:
 * 1. 内部スキーム（chrome://など）の早期リターン
 * 2. ドメインフィルタキャッシュを使用して、許可ドメイン外で早期リターン
 * 3. キャッシュがない場合のみバックグラウンドメッセージ通信
 */

// StorageKeys（簡易版 - content script で使用するもののみ）
const StorageKeys = {
    DOMAIN_FILTER_CACHE: 'domain_filter_cache',
    DOMAIN_FILTER_CACHE_TIMESTAMP: 'domain_filter_cache_timestamp',
    DOMAIN_FILTER_MODE: 'domain_filter_mode',
    DOMAIN_WHITELIST: 'domain_whitelist',
    DOMAIN_BLACKLIST: 'domain_blacklist',
    SIMPLE_FORMAT_ENABLED: 'simple_format_enabled',
    UBLOCK_FORMAT_ENABLED: 'ublock_format_enabled'
};

// 内部スキームの早期リターン定数
const SKIPPED_PROTOCOLS = [
    'chrome://',
    'chrome-extension://',
    'moz-extension://',
    'edge://',
    'about:blank',
    'about:srcdoc',
    'data:',
    'file://'
];

// キャッシュ有効期限（5分）
const CACHE_TTL = 5 * 60 * 1000;

/**
 * URL が抽出対象かどうかを判定（パフォーマンス最適化）
 * @param url - 判定対象 URL
 * @returns true でスキップ対象
 */
function shouldSkipUrl(url: string): boolean {
    if (!url) return true;
    return SKIPPED_PROTOCOLS.some(protocol => url.startsWith(protocol));
}

/**
 * ドメインを抽出して正規化
 * @param url - URL
 * @returns 正規化されたドメイン（失敗時はnull）
 */
function extractDomain(url: string): string | null {
    try {
        const urlObj = new URL(url);
        let hostname = urlObj.hostname;
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
 * @param domain - ドメイン
 * @param pattern - パターン
 * @returns 一致する場合true
 */
function matchesPattern(domain: string, pattern: string): boolean {
    if (pattern.includes('*')) {
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regexPattern = escaped.replace(/\\\*/g, '.*');
        const regex = new RegExp(`^${regexPattern}$`, 'i');
        return regex.test(domain);
    }
    return domain.toLowerCase() === pattern.toLowerCase();
}

/**
 * ドメインがリストに含まれるかチェック
 * @param domain - ドメイン
 * @param domainList - ドメインリスト
 * @returns 含まれる場合true
 */
function isDomainInList(domain: string, domainList: string[] | undefined): boolean {
    if (!domainList || domainList.length === 0) {
        return false;
    }
    return domainList.some(pattern => matchesPattern(domain, pattern));
}

/**
 * ドメインフィルタキャッシュから許可チェック
 * @param url - URL
 * @returns {Promise<{allowed: boolean, useCache: boolean}>}
 *   - allowed: trueで許可、falseで拒否
 *   - useCache: trueでキャッシュ使用、falseでバックグラウンドチェックが必要
 */
async function checkDomainAllowedFromCache(url: string): Promise<{ allowed: boolean; useCache: boolean }> {
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

// 即時実行関数
(async () => {
    // 【セキュリティとパフォーマンス最適化】内部スキームには早期リターン
    if (typeof window.location !== 'undefined' && shouldSkipUrl(window.location.href)) {
        return;
    }

    const url = window.location.href;

    // 【Task #19 最適化】キャッシュベースのドメインチェック
    const cacheCheck = await checkDomainAllowedFromCache(url);

    if (cacheCheck.useCache) {
        // キャッシュで判定可能な場合
        if (!cacheCheck.allowed) {
            return;  // 拒否ドメイン → 早期リターン
        }
        // 許可 → extractor を inject
        const src = chrome.runtime.getURL('content/extractor.js');
        await import(src);
        return;
    }

    // キャッシュがない場合のみ、バックグラウンドメッセージでドメインチェック
    const response = await chrome.runtime.sendMessage({ type: 'CHECK_DOMAIN' });
    if (!response || !response.allowed) {
        return;
    }

    // ビルド後のパスを指定（distディレクトリ内）
    const src = chrome.runtime.getURL('content/extractor.js');
    await import(src);
})();

// TypeScriptの`isolatedModules`設定を満たすためのダミーexport
export {};
