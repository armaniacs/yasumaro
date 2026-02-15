/**
 * validation.ts
 * uBlockインポートモジュール - バリデーション機能
 */
/**
 * URLに含まれる危険なプロトコルパターンのリスト
 */
const DANGEROUS_PROTOCOLS = [
    'javascript:', 'data:', 'vbscript:', 'file:',
    'chrome:', 'chrome-extension:', 'about:', 'mailto:', 'tel:',
    'sms:', 'fax:', 'blob:', 'content:', 'resource:',
    'eval:', 'script:', 'livescript:', 'ecmascript:', 'mocha:',
    'ws:', 'wss:', 'rtsp:', 'rtp:',
    'custom:', 'myprotocol:',
];
/**
 * URLが許可されたプロトコルかどうかをチェック
 * @param {string} url - 検証するURL
 * @returns {boolean} https/http/ftp プロトコルの場合true
 */
function hasAllowedProtocol(url) {
    const trimmedUrl = url.trim();
    if (!trimmedUrl.includes('://')) {
        return false;
    }
    const protocolRegex = /^(https?:\/\/|ftp:\/\/)/i;
    return protocolRegex.test(trimmedUrl);
}
/**
 * URLが危険なプロトコルを含んでいないかチェック
 * @param {string} url - 検証するURL
 * @returns {boolean} 危険なプロトコルを含まない場合true
 */
function lacksDangerousProtocols(url) {
    const lowercaseUrl = url.toLowerCase();
    const urlWithDecodedColon = lowercaseUrl.replace(/%3a/g, ':');
    for (const protocol of DANGEROUS_PROTOCOLS) {
        if (urlWithDecodedColon.startsWith(protocol)) {
            return false;
        }
    }
    return true;
}
/**
 * URLに基本的な構造があるかチェック
 * @param {string} url - 検証するURL
 * @returns {boolean} 基本的なURL構造がある場合true
 */
function hasValidUrlStructure(url) {
    const trimmedUrl = url.trim();
    const parts = trimmedUrl.split('://');
    if (parts.length < 2) {
        return false;
    }
    const afterProtocol = parts.slice(1).join('://');
    if (afterProtocol.length === 0) {
        return false;
    }
    if (afterProtocol.startsWith('/')) {
        return false;
    }
    return true;
}
/**
 * URLが安全なプロトコルかどうかを検証する
 * PRIV-003/SECURITY-007: URLバリデーションの強化
 * @param {string} url - 検証するURL
 * @returns {boolean} 安全なhttps/http/ftpプロトコルで、有効な構造の場合true
 */
export function isValidUrl(url) {
    if (!url) {
        return false;
    }
    const trimmedUrl = url.trim();
    if (!hasAllowedProtocol(trimmedUrl)) {
        return false;
    }
    if (!lacksDangerousProtocols(trimmedUrl)) {
        return false;
    }
    if (!hasValidUrlStructure(trimmedUrl)) {
        return false;
    }
    return true;
}
//# sourceMappingURL=validation.js.map