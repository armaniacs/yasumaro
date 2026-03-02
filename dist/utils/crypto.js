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
 * 【標準ブラウザAPIの優先使用】: crypto.subtle.timingSafeEqual() が利用可能な場合はそちらを使用
 * 【フォールバック実装】: 利用不可の場合は自前実装でタイミング安全に比較
 * @param {string} a - 比較する文字列1
 * @param {string} b - 比較する文字列2
 * @returns {Promise<boolean>} 文字列が等しい場合はtrue、それ以外はfalse
 */
export async function constantTimeCompare(a, b) {
    const webcrypto = getWebCrypto();
    // 標準ブラウザAPIが利用可能な場合は使用（MDN推奨）
    if ('subtle' in webcrypto && typeof webcrypto.subtle.timingSafeEqual === 'function') {
        try {
            const encoder = new TextEncoder();
            const aBuf = encoder.encode(a);
            const bBuf = encoder.encode(b);
            // Uint8Arrayの.backingストア（ArrayBuffer）を取得
            return await webcrypto.subtle.timingSafeEqual(aBuf.buffer, bBuf.buffer);
        }
        catch {
            // フォールバック実装へ
        }
    }
    // フォールバック実装: タイミング安全な比較
    // 文字列の長さ差もタイミング安全に組み込む
    const maxLength = Math.max(a.length, b.length);
    let result = 0;
    // 文字列長の差をタイミング安全に計算
    result |= a.length ^ b.length;
    // 最大長までループし、終了タイミングを固定化
    for (let i = 0; i < maxLength; i++) {
        // 範囲外なら0と比較（タイミング安全）
        const aChar = i < a.length ? a.charCodeAt(i) : 0;
        const bChar = i < b.length ? b.charCodeAt(i) : 0;
        result |= aChar ^ bChar;
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
// ============================================================================
// Notification Security Utils for HMAC Key Management
// ============================================================================
const HMAC_SIGNATURE_KEY_STORAGE = 'notification-signature-key';
const HMAC_SIGNATURE_KEY_VERSION = '1'; // Version tracking for key rotation
const textEncoder = new TextEncoder();
/**
 * Get or create HMAC signature key for notification IDs
 * @returns {Promise<CryptoKey>} HMAC-SHA256 signing key
 */
export async function getNotificationHmacKey() {
    const webcrypto = getWebCrypto();
    // Try to load encrypted key from storage
    try {
        const result = await chrome.storage.local.get([
            HMAC_SIGNATURE_KEY_STORAGE,
            HMAC_SIGNATURE_KEY_VERSION
        ]);
        const encryptedData = result[HMAC_SIGNATURE_KEY_STORAGE];
        if (encryptedData && isEncrypted(encryptedData)) {
            // Derive decryption key from extension ID (same as API key encryption)
            const extensionId = chrome.runtime.id;
            const salt = textEncoder.encode('notification-salt');
            const decryptKey = await deriveKeyWithExtensionId('notification-secret', salt, extensionId);
            const keyDataBase64 = await decryptData(encryptedData, decryptKey);
            const keyData = base64ToUint8Array(keyDataBase64);
            return await webcrypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
        }
    }
    catch (error) {
        // If loading fails, we'll generate a new key
        console.warn('Failed to load HMAC key, generating new one:', error);
    }
    // Generate new key
    const keyData = webcrypto.getRandomValues(new Uint8Array(32));
    // Encrypt the key with same mechanism as API keys
    const extensionId = chrome.runtime.id;
    const salt = textEncoder.encode('notification-salt');
    const encryptKey = await deriveKeyWithExtensionId('notification-secret', salt, extensionId);
    const encryptedKey = await encrypt(uint8ArrayToBase64(keyData), encryptKey);
    // Store encrypted key
    await chrome.storage.local.set({
        [HMAC_SIGNATURE_KEY_STORAGE]: encryptedKey,
        [HMAC_SIGNATURE_KEY_VERSION]: '1'
    });
    return await webcrypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
/**
 * Generate URL-safe base64 HMAC signature for notification IDs
 * Uses full signature (no truncation) for cryptographic guarantee
 * @param {string} data - Data to sign (typically URL)
 * @param {CryptoKey} key - HMAC key
 * @returns {Promise<string>} URL-safe base64 encoded full signature
 */
export async function generateHmacSignature(data, key) {
    const webcrypto = getWebCrypto();
    const dataArray = textEncoder.encode(data);
    const signature = await webcrypto.subtle.sign('HMAC', key, dataArray);
    const signatureChars = Array.from(new Uint8Array(signature), b => String.fromCharCode(b));
    return btoa(signatureChars.join(''))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}
/**
 * Verify HMAC signature using constant-time comparison
 * @param {string} data - Original data
 * @param {string} signature - URL-safe base64 encoded signature
 * @param {CryptoKey} key - HMAC key
 * @returns {Promise<boolean>} True if signature is valid
 */
export async function verifyHmacSignature(data, signature, key) {
    try {
        const computedSignature = await generateHmacSignature(data, key);
        const webcrypto = getWebCrypto();
        // Use constantTimeCompare if available (from crypto.ts)
        const encoder = textEncoder;
        const sigBuf = encoder.encode(signature);
        const compBuf = encoder.encode(computedSignature);
        // Check length mismatch first (timing-safe via length comparison)
        if (sigBuf.byteLength !== compBuf.byteLength) {
            return false;
        }
        // Use browser's timingSafeEqual if available
        if ('subtle' in webcrypto && typeof webcrypto.subtle.timingSafeEqual === 'function') {
            try {
                return await webcrypto.subtle.timingSafeEqual(sigBuf.buffer, compBuf.buffer);
            }
            catch {
                // Fall through to manual comparison
            }
        }
        // Manual constant-time comparison
        let result = 0;
        const sig8 = new Uint8Array(sigBuf);
        const comp8 = new Uint8Array(compBuf);
        for (let i = 0; i < sigBuf.byteLength; i++) {
            result |= sig8[i] ^ comp8[i];
        }
        return result === 0;
    }
    catch {
        return false;
    }
}
// Helper functions for uint8Array <-> base64 conversion
function uint8ArrayToBase64(bytes) {
    return btoa(String.fromCharCode(...bytes));
}
function base64ToUint8Array(base64) {
    const binaryString = atob(base64);
    return Uint8Array.from(binaryString, c => c.charCodeAt(0));
}
// ============================================================================
// Privacy Utils for Hash-Based Logging
// ============================================================================
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
export async function hashUrl(url) {
    const webcrypto = getWebCrypto();
    const msgBuffer = textEncoder.encode(url);
    const hashBuffer = await webcrypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return `[hash:${hashHex.substring(0, 8)}]`;
}
//# sourceMappingURL=crypto.js.map