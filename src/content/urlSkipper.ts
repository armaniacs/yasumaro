/**
 * urlSkipper.ts
 * Content Script で使用する URL スキップ判定ロジック。
 * loader.ts から分離（loader.ts は Content Script エントリポイントのため export 不可）。
 */

import { matchesDomainPattern, isDomainInList as isDomainInListShared, extractHostname } from '../utils/wildcardToRegex.js';

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
    return extractHostname(url);
}

/**
 * パターンマッチング（ワイルドカード対応）
 * @param domain - ドメイン
 * @param pattern - パターン（* をワイルドカードとして使用可能）
 * @returns 一致する場合true
 *
 * 単一共有パス matchesDomainPattern への shim（PBI-18）。
 * ReDoS ガード（MAX_WILDCARDS_PER_PATTERN 上限）は共有側で継承する。
 */
export function matchesPattern(domain: string, pattern: string): boolean {
    return matchesDomainPattern(domain, pattern);
}

/**
 * ドメインがリストに含まれるかチェック
 * @param domain - ドメイン
 * @param domainList - ドメインリスト（undefinedの場合はfalse）
 * @returns 含まれる場合true
 */
export function isDomainInList(domain: string, domainList: string[] | undefined): boolean {
    return isDomainInListShared(domain, domainList);
}
