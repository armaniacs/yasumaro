/**
 * crypto.ts
 * Web Crypto APIを使用した暗号化・復号化ユーティリティ
 * 【機能概要】: APIキーの暗号化・復号化、マスターパスワードのハッシュ化・検証
 * 【設計方針】: AES-GCM認証付き暗号化、PBKDF2キー導出
 * 【セキュリティ】: 導出キーはメモリにのみ保存、ソルトとハッシュのみを永続化
 */
import type { EncryptedData } from './typesCrypto.js';
/**
 * ランダムなソルトを生成する
 * @returns {Uint8Array} 16バイトのソルト
 */
export declare function generateSalt(): Uint8Array;
/**
 * ランダムなIV（初期化ベクトル）を生成する
 * @returns {Uint8Array} 12バイトのIV
 */
export declare function generateIV(): Uint8Array;
/**
 * 定数時間比較（タイミング攻撃対策）
 * 2つの文字列を定数時間で比較し、タイミング攻撃を防ぐ
 * 【標準ブラウザAPIの優先使用】: crypto.subtle.timingSafeEqual() が利用可能な場合はそちらを使用
 * 【フォールバック実装】: 利用不可の場合は自前実装でタイミング安全に比較
 * @param {string} a - 比較する文字列1
 * @param {string} b - 比較する文字列2
 * @returns {Promise<boolean>} 文字列が等しい場合はtrue、それ以外はfalse
 */
export declare function constantTimeCompare(a: string, b: string): Promise<boolean>;
/**
 * パスワードをハッシュ化する
 * @param {string} password - 平文パスワード
 * @returns {Promise<string>} Base64エンコードされたハッシュ
 */
export declare function hashPassword(password: string): Promise<string>;
/**
 * パスワードを検証する
 * @param {string} password - 平文パスワード
 * @param {string} hash - 比較対象のハッシュ（Base64エンコード）
 * @returns {Promise<boolean>} パスワードが一致するかどうか
 */
export declare function verifyPassword(password: string, hash: string): Promise<boolean>;
/**
 * パスワードとソルトから暗号化キーを導出する
 * @param {string} password - マスターパスワード
 * @param {Uint8Array} salt - ソルト
 * @returns {Promise<CryptoKey>} 導出された暗号化キー
 */
export declare function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey>;
/**
 * 暗号化キーを導出する（Extension IDを使用）
 * chrome.runtime.idをキー導出に組み込むことで、異なる環境間のデータ分離を実現
 * @param {string} secret - 共有シークレット
 * @param {Uint8Array} salt - ソルト
 * @param {string} extensionId - 拡張機能ID
 * @returns {Promise<CryptoKey>} 導出された暗号化キー
 */
export declare function deriveKeyWithExtensionId(secret: string, salt: Uint8Array, extensionId: string): Promise<CryptoKey>;
/**
 * 平文を暗号化する
 * @param {string} plaintext - 平文
 * @param {CryptoKey} key - 暗号化キー
 * @returns {Promise<EncryptedData>} 暗号文とIV（Base64エンコード）
 */
export declare function encrypt(plaintext: string, key: CryptoKey): Promise<EncryptedData>;
/**
 * 暗号文を復号化する
 * @param {string} ciphertext - 暗号文（Base64エンコード）
 * @param {string} iv - IV（Base64エンコード）
 * @param {CryptoKey} key - 暗号化キー
 * @returns {Promise<string>} 復号された平文
 * @throws {Error} 復号化に失敗した場合
 */
export declare function decrypt(ciphertext: string, iv: string, key: CryptoKey): Promise<string>;
/**
 * 暗号化されたデータを復号化する（オブジェクト形式）
 * @param {EncryptedData} encryptedData - 暗号化データ
 * @param {CryptoKey} key - 暗号化キー
 * @returns {Promise<string>} 復号された平文
 */
export declare function decryptData(encryptedData: EncryptedData, key: CryptoKey): Promise<string>;
/**
 * データが暗号化されているかをチェックする
 * @param {unknown} data - チェック対象のデータ
 * @returns {boolean} 暗号化されているかどうか
 */
export declare function isEncrypted(data: unknown): data is EncryptedData;
/**
 * APIキーを暗号化する（ユーティリティ関数）
 * @param {string} apiKey - APIキー
 * @param {CryptoKey} key - 暗号化キー
 * @returns {Promise<EncryptedData>} 暗号化されたAPIキー
 */
export declare function encryptApiKey(apiKey: string, key: CryptoKey): Promise<EncryptedData>;
/**
 * APIキーを復号化する（ユーティリティ関数）
 * @param {EncryptedData | string} encryptedApiKey - 暗号化されたAPIキーまたは平文
 * @param {CryptoKey} key - 暗号化キー
 * @returns {Promise<string>} 復号されたAPIキー
 */
export declare function decryptApiKey(encryptedApiKey: EncryptedData | string, key: CryptoKey): Promise<string>;
/**
 * HMAC-SHA256を使用してハッシュを計算する
 * @param {string} secret - 共有シークレット
 * @param {string} message - メッセージ
 * @returns {Promise<string>} Base64エンコードされたHMACハッシュ
 */
export declare function computeHMAC(secret: string, message: string): Promise<string>;
/**
 * 【セキュリティ修正】PBKDF2を使用したパスワードハッシュ化
 * パスワードを安全に保存するため、PBKDF2でハッシュ化（100,000回のイテレーション）
 * @param {string} password - パスワード
 * @param {Uint8Array} salt - ソルト
 * @returns {Promise<string>} Base64エンコードされたパスワードハッシュ
 */
export declare function hashPasswordWithPBKDF2(password: string, salt: Uint8Array): Promise<string>;
/**
 * パスワードハッシュを検証する（PBKDF2）
 * @param {string} password - 検証するパスワード
 * @param {string} storedHash - 保存されているハッシュ（Base64）
 * @param {Uint8Array} salt - 使用されたソルト
 * @returns {Promise<boolean>} パスワードが正しければtrue
 */
export declare function verifyPasswordWithPBKDF2(password: string, storedHash: string, salt: Uint8Array): Promise<boolean>;
/**
 * Get or create HMAC signature key for notification IDs
 * @returns {Promise<CryptoKey>} HMAC-SHA256 signing key
 */
export declare function getNotificationHmacKey(): Promise<CryptoKey>;
/**
 * Generate URL-safe base64 HMAC signature for notification IDs
 * Uses full signature (no truncation) for cryptographic guarantee
 * @param {string} data - Data to sign (typically URL)
 * @param {CryptoKey} key - HMAC key
 * @returns {Promise<string>} URL-safe base64 encoded full signature
 */
export declare function generateHmacSignature(data: string, key: CryptoKey): Promise<string>;
/**
 * Verify HMAC signature using constant-time comparison
 * @param {string} data - Original data
 * @param {string} signature - URL-safe base64 encoded signature
 * @param {CryptoKey} key - HMAC key
 * @returns {Promise<boolean>} True if signature is valid
 */
export declare function verifyHmacSignature(data: string, signature: string, key: CryptoKey): Promise<boolean>;
/**
 * URLのSHA-256ハッシュを生成し、先頭8文字のプレフィックス付き文字列を返す
 * ログ出力時のプライバシー保護用（URLの生値を直接ログに記録しないため）
 * @param {string} url - ハッシュ化するURL
 * @returns {Promise<string>} 先頭8文字のSHA-256ハッシュ値（プレフィックス付き）
 *
 * @example
 * const hash = await hashUrl('https://example.com/path');
 * // Returns: '[hash:a1b2c3d4]'
 */
export declare function hashUrl(url: string): Promise<string>;
//# sourceMappingURL=crypto.d.ts.map