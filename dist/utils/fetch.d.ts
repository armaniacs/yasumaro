/**
 * fetch.ts
 * タイムアウト付きfetchラッパー
 *
 * Security features (from P1 code review):
 * - Parameter validation for timeoutMs
 * - Support for optional URL validation
 */
interface FetchOptions extends RequestInit {
    requireValidProtocol?: boolean;
    blockLocalhost?: boolean;
    allowedUrls?: Set<string> | null;
}
/**
 * タイムアウト付きfetchラッパー
 * @param {string} url - リクエストURL
 * @param {FetchOptions} options - fetchオプションとURL検証オプション
 * @param {number} timeoutMs - タイムアウト時間（ミリ秒）、デフォルト30000ms
 * @returns {Promise<Response>} fetchレスポンス
 * @throws {Error} 無効なURL、タイムアウト、またはネットワークエラー
 */
export declare function fetchWithTimeout(url: string, options?: FetchOptions, timeoutMs?: number): Promise<Response>;
/**
 * プライベートIPアドレスかどうか判定
 * @param {string} hostname - チェックするホスト名
 * @returns {boolean} プライベートIPの場合true
 */
export declare function isPrivateIpAddress(hostname: string): boolean;
/**
 * uBlockインポート用URLの検証（内部ネットワークブロック）
 * SSRF対策 - 内部ネットワークアドレスへのアクセスを防止
 * @param {string} url - 検証するURL
 * @throws {Error} URLが無効またはプライベートネットワークの場合
 */
export declare function validateUrlForFilterImport(url: string): void;
/**
 * 動的URL検証
 * @param {string} url - 検証するURL
 * @param {Set<string> | null} allowedUrls - 許可されたURLのセット
 * @returns {boolean} 許可されたURLの場合true
 */
export declare function isUrlAllowed(url: string, allowedUrls: Set<string> | null): boolean;
/**
 * AIリクエスト用URLの検証（SSRF対策）
 * 内部ネットワークアドレスへのアクセスを防止
 * @param {string} url - 検証するURL
 * @throws {Error} URLが無効またはプライベートネットワークの場合
 */
export declare function validateUrlForAIRequests(url: string): void;
export {};
//# sourceMappingURL=fetch.d.ts.map