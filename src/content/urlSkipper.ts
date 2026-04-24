/**
 * urlSkipper.ts
 * Content Script で使用する URL スキップ判定ロジック。
 * loader.ts から分離（loader.ts は Content Script エントリポイントのため export 不可）。
 */

export const SKIPPED_PROTOCOLS = [
    'chrome://',
    'chrome-extension://',
    'moz-extension://',
    'edge://',
    'about:blank',
    'about:srcdoc',
    'data:',
    'file://'
] as const;

/**
 * URL が抽出対象かどうかを判定（パフォーマンス最適化）
 * @param url - 判定対象 URL
 * @returns true でスキップ対象
 */
export function shouldSkipUrl(url: string): boolean {
    if (!url) return true;
    return SKIPPED_PROTOCOLS.some(protocol => url.startsWith(protocol));
}

/**
 * ドメインを抽出して正規化（www. 除去）
 * @param url - URL
 * @returns 正規化されたドメイン（失敗時はnull）
 */
export function extractDomain(url: string): string | null {
    try {
        const urlObj = new URL(url);
        let hostname = urlObj.hostname;
        if (hostname.startsWith('www.')) {
            hostname = hostname.substring(4);
        }
        return hostname;
    } catch {
        return null;
    }
}

/**
 * パターンマッチング（ワイルドカード対応）
 * @param domain - ドメイン
 * @param pattern - パターン（* をワイルドカードとして使用可能）
 * @returns 一致する場合true
 */
export function matchesPattern(domain: string, pattern: string): boolean {
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
 * @param domainList - ドメインリスト（undefinedの場合はfalse）
 * @returns 含まれる場合true
 */
export function isDomainInList(domain: string, domainList: string[] | undefined): boolean {
    if (!domainList || domainList.length === 0) {
        return false;
    }
    return domainList.some(pattern => matchesPattern(domain, pattern));
}
