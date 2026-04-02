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
