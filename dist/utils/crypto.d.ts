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
//# sourceMappingURL=crypto.d.ts.map