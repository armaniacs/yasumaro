/**
 * urlUtils.ts
 * URL操作に関する共通ユーティリティ関数
 */

/**
 * URLの正規化
 * 末尾のスラッシュを削除し、プロトコルを小文字に正規化
 * @param {string} url - 正規化するURL
 * @returns {string} 正規化されたURL
 * @throws {Error} URLが無効な場合
 */
export function normalizeUrl(url: string): string {
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(url);
    } catch (_e) {
        throw new Error('Invalid URL');
    }
    // 末尾のスラッシュを削除
    let normalized = parsedUrl.href.replace(/\/$/, '');
    // プロトコルを小文字に正規化
    normalized = normalized.replace(/^https:/i, 'https:');
    normalized = normalized.replace(/^http:/i, 'http:');
    return normalized;
}

/**
 * URLの正規化（キャッシュキー用・非throw版）
 * hash を除去し、末尾スラッシュを除去（ルートパス以外）。パース失敗時は元のURLを返す。
 * normalizeUrl とは意図的に挙動が異なる（throw しない）。
 * headerDetector / PrivacyCache の同型実装との統合はキャッシュキー意味論の確認が
 * 必要なため別 PBI（PBI 2026-09-07-24 では popup 側の重複のみ解消）。
 */
export function normalizeUrlSafe(url: string): string {
    try {
        const parsed = new URL(url);
        parsed.hash = '';
        let normalized = parsed.toString();
        if (normalized.endsWith('/') && parsed.pathname !== '/') {
            normalized = normalized.slice(0, -1);
        }
        return normalized;
    } catch {
        return url;
    }
}

/**
 * 安全なURLか判定（http/httpsのみ許可）
 * @param {string} url - 検証するURL
 * @returns {boolean} 安全なURLかどうか
 */
export function isSecureUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * URLをログ記録用にサニタイズ（ドメインのみを抽出）
 * @param {string} url - サニタイズするURL
 * @returns {string} ドメインのみの安全な文字列
 */
export function sanitizeUrlForLogging(url: string): string {
    try {
        const parsed = new URL(url);
        return parsed.hostname || '[INVALID_URL]';
    } catch {
        return '[INVALID_URL]';
    }
}

/**
 * URLのパス情報を削除したサニタイズ版（詳細デバッグ用）
 * @param {string} url - サニタイズするURL
 * @returns {string} プロトコル+ドメインのみ
 */
export function urlWithoutPath(url: string): string {
    try {
        const parsed = new URL(url);
        return `${parsed.protocol}//${parsed.hostname}${parsed.port ? ':' + parsed.port : ''}`;
    } catch {
        return '[INVALID_URL]';
    }
}
