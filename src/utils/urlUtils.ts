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
    } catch (e) {
        throw new Error('Invalid URL');
    }
    // 末尾のスラッシュを削除
    let normalized = parsedUrl.href.replace(/\/$/, '');
    // プロトコルを小文字に正規化
    normalized = normalized.replace(/^https:/i, 'https:');
    normalized = normalized.replace(/^http:/i, 'http:');
    return normalized;
}
