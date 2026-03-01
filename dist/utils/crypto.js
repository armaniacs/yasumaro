/**
 * crypto.ts
 * Web Crypto APIを使用した暗号化・復号化ユーティリティ
 * 【機能概要】: APIキーの暗号化・復号化、マスターパスワードのハッシュ化・検証
 * 【設計方針】: AES-GCM認証付き暗号化、PBKDF2キー導出
 * 【セキュリティ】: 導出キーはメモリにのみ保存、ソルトとハッシュのみを永続化
 */
// 定数設定
const PBKDF2_ITERATIONS = 100000;
const KEY_LENGTH = 256; // bits
const SALT_LENGTH = 16; // bytes
const IV_LENGTH = 12; // bytes (recommended for AES-GCM)
const HASH_ALGORITHM = 'SHA-256';
const ENCRYPTION_ALGORITHM = 'AES-GCM';
/**
 * Web Crypto APIのインスタンスを取得する
 * global.crypto.subtleが利用可能ならglobal.cryptoを使用し、なければcryptoを使用
 * @returns {Crypto} Web Crypto APIインスタンス
 */
function getWebCrypto() {
    if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
        return globalThis.crypto;
    }
    // Node.js environment or fallback
    return crypto;
}
/**
 * ランダムなソルトを生成する
 * @returns {Uint8Array} 16バイトのソルト
 */
export function generateSalt() {
    return getWebCrypto().getRandomValues(new Uint8Array(SALT_LENGTH));
}
/**
 * ランダムなIV（初期化ベクトル）を生成する
 * @returns {Uint8Array} 12バイトのIV
 */
export function generateIV() {
    return getWebCrypto().getRandomValues(new Uint8Array(IV_LENGTH));
}
/**
 * 定数時間比較（タイミング攻撃対策）
 * 2つの文字列を定数時間で比較し、タイミング攻撃を防ぐ
 * @param {string} a - 比較する文字列1
 * @param {string} b - 比較する文字列2
 * @returns {boolean} 文字列が等しい場合はtrue、それ以外はfalse
 */
function constantTimeCompare(a, b) {
    // 文字列長が異なる場合は即座にfalseを返す
    if (a.length !== b.length) {
        return false;
    }
    // XORの累積を行い、文字長にかかわらず一定時間で処理する
    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
}
/**
 * パスワードをハッシュ化する
 * @param {string} password - 平文パスワード
 * @returns {Promise<string>} Base64エンコードされたハッシュ
 */
export async function hashPassword(password) {
    const webcrypto = getWebCrypto();
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await webcrypto.subtle.digest(HASH_ALGORITHM, data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return btoa(String.fromCharCode(...hashArray));
}
/**
 * パスワードを検証する
 * @param {string} password - 平文パスワード
 * @param {string} hash - 比較対象のハッシュ（Base64エンコード）
 * @returns {Promise<boolean>} パスワードが一致するかどうか
 */
export async function verifyPassword(password, hash) {
    const computedHash = await hashPassword(password);
    return constantTimeCompare(computedHash, hash);
}
/**
 * パスワードとソルトから暗号化キーを導出する
 * @param {string} password - マスターパスワード
 * @param {Uint8Array} salt - ソルト
 * @returns {Promise<CryptoKey>} 導出された暗号化キー
 */
export async function deriveKey(password, salt) {
    const webcrypto = getWebCrypto();
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);
    // PBKDF2を使用してキーを導出
    const baseKey = await webcrypto.subtle.importKey('raw', passwordBuffer, 'PBKDF2', false, ['deriveKey']);
    const derivedKey = await webcrypto.subtle.deriveKey({
        name: 'PBKDF2',
        salt: salt,
        iterations: PBKDF2_ITERATIONS,
        hash: HASH_ALGORITHM
    }, baseKey, {
        name: ENCRYPTION_ALGORITHM,
        length: KEY_LENGTH
    }, false, ['encrypt', 'decrypt']);
    return derivedKey;
}
/**
 * 暗号化キーを導出する（Extension IDを使用）
 * chrome.runtime.idをキー導出に組み込むことで、異なる環境間のデータ分離を実現
 * @param {string} secret - 共有シークレット
 * @param {Uint8Array} salt - ソルト
 * @param {string} extensionId - 拡張機能ID
 * @returns {Promise<CryptoKey>} 導出された暗号化キー
 */
export async function deriveKeyWithExtensionId(secret, salt, extensionId) {
    // secret + extensionId を組み合わせてキー導出用のパスワードを作成
    const combinedPassword = `${secret}:${extensionId}`;
    return deriveKey(combinedPassword, salt);
}
/**
 * 平文を暗号化する
 * @param {string} plaintext - 平文
 * @param {CryptoKey} key - 暗号化キー
 * @returns {Promise<EncryptedData>} 暗号文とIV（Base64エンコード）
 */
export async function encrypt(plaintext, key) {
    const webcrypto = getWebCrypto();
    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);
    const iv = generateIV();
    const ciphertextBuffer = await webcrypto.subtle.encrypt({
        name: ENCRYPTION_ALGORITHM,
        iv: iv
    }, key, data);
    const ciphertextArray = Array.from(new Uint8Array(ciphertextBuffer));
    const ivArray = Array.from(iv);
    return {
        ciphertext: btoa(String.fromCharCode(...ciphertextArray)),
        iv: btoa(String.fromCharCode(...ivArray))
    };
}
/**
 * 暗号文を復号化する
 * @param {string} ciphertext - 暗号文（Base64エンコード）
 * @param {string} iv - IV（Base64エンコード）
 * @param {CryptoKey} key - 暗号化キー
 * @returns {Promise<string>} 復号された平文
 * @throws {Error} 復号化に失敗した場合
 */
export async function decrypt(ciphertext, iv, key) {
    try {
        const webcrypto = getWebCrypto();
        // Base64デコード
        const ciphertextArray = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
        const ivArray = Uint8Array.from(atob(iv), c => c.charCodeAt(0));
        const plaintextBuffer = await webcrypto.subtle.decrypt({
            name: ENCRYPTION_ALGORITHM,
            iv: ivArray
        }, key, ciphertextArray);
        const decoder = new TextDecoder();
        return decoder.decode(plaintextBuffer);
    }
    catch (error) {
        throw new Error('Decryption failed: Invalid key or corrupted data');
    }
}
/**
 * 暗号化されたデータを復号化する（オブジェクト形式）
 * @param {EncryptedData} encryptedData - 暗号化データ
 * @param {CryptoKey} key - 暗号化キー
 * @returns {Promise<string>} 復号された平文
 */
export async function decryptData(encryptedData, key) {
    if (!encryptedData || !encryptedData.ciphertext || !encryptedData.iv) {
        throw new Error('Invalid encrypted data format');
    }
    return decrypt(encryptedData.ciphertext, encryptedData.iv, key);
}
/**
 * データが暗号化されているかをチェックする
 * @param {unknown} data - チェック対象のデータ
 * @returns {boolean} 暗号化されているかどうか
 */
export function isEncrypted(data) {
    return Boolean(data !== null &&
        data !== undefined &&
        typeof data === 'object' &&
        'ciphertext' in data &&
        typeof data.ciphertext === 'string' &&
        'iv' in data &&
        typeof data.iv === 'string');
}
/**
 * APIキーを暗号化する（ユーティリティ関数）
 * @param {string} apiKey - APIキー
 * @param {CryptoKey} key - 暗号化キー
 * @returns {Promise<EncryptedData>} 暗号化されたAPIキー
 */
export async function encryptApiKey(apiKey, key) {
    if (!apiKey || typeof apiKey !== 'string') {
        throw new Error('Invalid API key');
    }
    return encrypt(apiKey, key);
}
/**
 * APIキーを復号化する（ユーティリティ関数）
 * @param {EncryptedData | string} encryptedApiKey - 暗号化されたAPIキーまたは平文
 * @param {CryptoKey} key - 暗号化キー
 * @returns {Promise<string>} 復号されたAPIキー
 */
export async function decryptApiKey(encryptedApiKey, key) {
    // 平文の場合はそのまま返す（後方互換性）
    if (typeof encryptedApiKey === 'string') {
        return encryptedApiKey;
    }
    // 暗号化されている場合は復号化
    if (isEncrypted(encryptedApiKey)) {
        return decryptData(encryptedApiKey, key);
    }
    throw new Error('Invalid API key format');
}
/**
 * HMAC-SHA256を使用してハッシュを計算する
 * @param {string} secret - 共有シークレット
 * @param {string} message - メッセージ
 * @returns {Promise<string>} Base64エンコードされたHMACハッシュ
 */
export async function computeHMAC(secret, message) {
    const webcrypto = getWebCrypto();
    const encoder = new TextEncoder();
    const secretKey = await webcrypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await webcrypto.subtle.sign('HMAC', secretKey, encoder.encode(message));
    const signatureArray = Array.from(new Uint8Array(signature));
    return btoa(String.fromCharCode(...signatureArray));
}
/**
 * 【セキュリティ修正】PBKDF2を使用したパスワードハッシュ化
 * パスワードを安全に保存するため、PBKDF2でハッシュ化（100,000回のイテレーション）
 * @param {string} password - パスワード
 * @param {Uint8Array} salt - ソルト
 * @returns {Promise<string>} Base64エンコードされたパスワードハッシュ
 */
export async function hashPasswordWithPBKDF2(password, salt) {
    const webcrypto = getWebCrypto();
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);
    const baseKey = await webcrypto.subtle.importKey('raw', passwordBuffer, 'PBKDF2', false, ['deriveBits']);
    const derivedBits = await webcrypto.subtle.deriveBits({
        name: 'PBKDF2',
        salt: salt,
        iterations: PBKDF2_ITERATIONS,
        hash: HASH_ALGORITHM
    }, baseKey, 256 // 256 bits = 32 bytes
    );
    const hashArray = Array.from(new Uint8Array(derivedBits));
    return btoa(String.fromCharCode(...hashArray));
}
/**
 * パスワードハッシュを検証する（PBKDF2）
 * @param {string} password - 検証するパスワード
 * @param {string} storedHash - 保存されているハッシュ（Base64）
 * @param {Uint8Array} salt - 使用されたソルト
 * @returns {Promise<boolean>} パスワードが正しければtrue
 */
export async function verifyPasswordWithPBKDF2(password, storedHash, salt) {
    const computedHash = await hashPasswordWithPBKDF2(password, salt);
    return constantTimeCompare(computedHash, storedHash);
}
//# sourceMappingURL=crypto.js.map