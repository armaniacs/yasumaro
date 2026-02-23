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
 * 【URL検証バイパス対策】JavaScriptのURLクラスを使用した厳格な検証を追加
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
 * URLクラスを使用した厳格なURL構造検証
 * 【URL検証バイパス対策】URL.parseを利用してプロトコル、ホスト名、パスの妥当性を検証
 * @param {string} url - 検証するURL
 * @returns {boolean} 有効なURL構造の場合true
 */
function hasStrictValidUrlStructure(url) {
    try {
        const parsedUrl = new URL(url);
        // プロトコルの厳格なチェック（http/https/ftpのみ許可）
        const validProtocols = ['http:', 'https:', 'ftp:'];
        if (!validProtocols.includes(parsedUrl.protocol)) {
            return false;
        }
        // ホスト名の存在チェック
        if (!parsedUrl.hostname || parsedUrl.hostname === 'about:blank') {
            return false;
        }
        // ホスト名が空ではなく、有効な文字を含んでいるかチェック
        // 改行、制御文字などが含まれている場合を拒否
        if (/[\x00-\x1F\x7F]/.test(parsedUrl.hostname)) {
            return false;
        }
        // IPv6アドレスのチェック（ブラケットで囲まれる）
        if (parsedUrl.hostname.startsWith('[') && parsedUrl.hostname.endsWith(']')) {
            const ipv6Address = parsedUrl.hostname.slice(1, -1);
            // 空でないIPv6アドレスのみ許可
            if (!ipv6Address || ipv6Address.length === 0) {
                return false;
            }
            // 無効な文字を含むIPv6アドレスを拒否
            if (!/^[\da-fA-F:.]+$/.test(ipv6Address)) {
                return false;
            }
            return true;
        }
        // ホスト名がドメイン形式かIPアドレス形式かチェック
        // 最小限のドメインバリデーション（ラベルごとのチェック）
        const labels = parsedUrl.hostname.split('.');
        if (labels.length === 0) {
            return false;
        }
        // 各ラベルの長さとキャラクタチェック
        for (const label of labels) {
            if (label.length === 0) {
                return false;
            }
            if (label.length > 63) {
                return false;
            }
            // 有効なドメイン文字のみ許可
            if (!/^[a-z0-9-]+$/i.test(label)) {
                return false;
            }
            // ラベルの先頭と末尾にハイフンを許可しない
            if (/^-/.test(label) || /-$/.test(label)) {
                return false;
            }
        }
        return true;
    }
    catch (e) {
        // URL.parseが失敗した場合、無効なURLとみなす
        return false;
    }
}
/**
 * URLが安全なプロトコルかどうかを検証する
 * PRIV-003/SECURITY-007: URLバリデーションの強化
 * 【URL検証バイパス対策】厳格なURL構造検証を追加
 * @param {string} url - 検証するURL
 * @returns {boolean} 安全なhttps/http/ftpプロトコルで、有効な構造の場合true
 */
export function isValidUrl(url) {
    if (!url) {
        return false;
    }
    // URLパース前に制御文字（nullバイトを含む）をチェック
    // URLクラスがnullバイトを自動的にサニタイズしてしまうため、ここで事前にチェック
    if (/[\x00-\x1F\x7F]/.test(url)) {
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
    // 【URL検証バイパス対策】厳格なURL構造検証を追加
    if (!hasStrictValidUrlStructure(trimmedUrl)) {
        return false;
    }
    return true;
}
//# sourceMappingURL=validation.js.map