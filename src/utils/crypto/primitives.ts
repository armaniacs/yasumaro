/**
 * crypto/primitives.ts
 * Web Crypto APIを使用した汎用暗号化・復号化プリミティブ
 * 【機能概要】: APIキーの暗号化・復号化、マスターパスワードのハッシュ化・検証
 * 【設計方針】: AES-GCM認証付き暗号化、PBKDF2キー導出
 * 【セキュリティ】: 導出キーはメモリにのみ保存、ソルトとハッシュのみを永続化
 *
 * chrome.storage への副作用を持たない純粋な暗号プリミティブのみを含む。
 * HMAC鍵の永続化・ラップは crypto/hmacKeyStore.ts、
 * バージョン付きエンベロープ形式は crypto/envelope.ts を参照。
 */

import type { EncryptedData } from './types.js';

// 定数設定
const PBKDF2_ITERATIONS = 100000;
const KEY_LENGTH = 256; // bits
const IV_LENGTH = 12; // bytes (recommended for AES-GCM)
const HASH_ALGORITHM = 'SHA-256';
const ENCRYPTION_ALGORITHM = 'AES-GCM';
const SALT_LENGTH = 16; // bytes

// Versioned Encryption Envelope (H3) constants
// Declared here (not in envelope.ts) so hashPasswordWithPBKDF2 /
// verifyPasswordWithPBKDF2 can reference them without TDZ hazards, and so
// envelope.ts can import them alongside deriveKey.
export const CURRENT_ENVELOPE_VERSION = 2;
export const ENVELOPE_ITERATIONS = 600_000;

/**
 * Web Crypto APIのインスタンスを取得する
 * global.crypto.subtleが利用可能ならglobal.cryptoを使用し、なければcryptoを使用
 * @returns {Crypto} Web Crypto APIインスタンス
 */
export function getWebCrypto(): Crypto {
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
export function generateSalt(): Uint8Array {
    return getWebCrypto().getRandomValues(new Uint8Array(SALT_LENGTH));
}

/**
 * ランダムなIV（初期化ベクトル）を生成する
 * @returns {Uint8Array} 12バイトのIV
 */
export function generateIV(): Uint8Array {
    return getWebCrypto().getRandomValues(new Uint8Array(IV_LENGTH));
}

/**
 * 定数時間比較（タイミング攻撃対策）
 * 2つの文字列を定数時間で比較し、タイミング攻撃を防ぐ
 * 【フォールバック実装】: 自前実装でタイミング安全に比較
 * @param {string} a - 比較する文字列1
 * @param {string} b - 比較する文字列2
 * @returns {Promise<boolean>} 文字列が等しい場合はtrue、それ以外はfalse
 */
export async function constantTimeCompare(a: string, b: string): Promise<boolean> {
    // タイミング安全な比較
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
 * パスワードとソルトから暗号化キーを導出する
 * @param {string} password - マスターパスワード
 * @param {Uint8Array} salt - ソルト
 * @returns {Promise<CryptoKey>} 導出された暗号化キー
 */
export async function deriveKey(password: string, salt: Uint8Array, iterations: number = PBKDF2_ITERATIONS, hash: string = HASH_ALGORITHM): Promise<CryptoKey> {
    const webcrypto = getWebCrypto();
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);

    // PBKDF2を使用してキーを導出
    const baseKey = await webcrypto.subtle.importKey(
        'raw',
        passwordBuffer,
        'PBKDF2',
        false,
        ['deriveKey']
    );

    const derivedKey = await webcrypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt as BufferSource,
            iterations: iterations,
            hash: hash
        },
        baseKey,
        {
            name: ENCRYPTION_ALGORITHM,
            length: KEY_LENGTH
        },
        false,
        ['encrypt', 'decrypt']
    );

    return derivedKey;
}

/**
 * 平文を暗号化する
 * @param {string} plaintext - 平文
 * @param {CryptoKey} key - 暗号化キー
 * @returns {Promise<EncryptedData>} 暗号文とIV（Base64エンコード）
 */
export async function encrypt(plaintext: string, key: CryptoKey): Promise<EncryptedData> {
    const webcrypto = getWebCrypto();
    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);
    const iv = generateIV();

    const ciphertextBuffer = await webcrypto.subtle.encrypt(
        {
            name: ENCRYPTION_ALGORITHM,
            iv: iv as BufferSource
        },
        key,
        data
    );

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
export async function decrypt(ciphertext: string, iv: string, key: CryptoKey): Promise<string> {
    try {
        const webcrypto = getWebCrypto();
        // Base64デコード
        const ciphertextArray = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
        const ivArray = Uint8Array.from(atob(iv), c => c.charCodeAt(0));

        const plaintextBuffer = await webcrypto.subtle.decrypt(
            {
                name: ENCRYPTION_ALGORITHM,
                iv: ivArray
            },
            key,
            ciphertextArray
        );

        const decoder = new TextDecoder();
        return decoder.decode(plaintextBuffer);
    } catch (_error: unknown) {
        throw new Error('Decryption failed: Invalid key or corrupted data');
    }
}

/**
 * 暗号化されたデータを復号化する（オブジェクト形式）
 * @param {EncryptedData} encryptedData - 暗号化データ
 * @param {CryptoKey} key - 暗号化キー
 * @returns {Promise<string>} 復号された平文
 */
export async function decryptData(encryptedData: EncryptedData, key: CryptoKey): Promise<string> {
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
export function isEncrypted(data: unknown): data is EncryptedData {
    return Boolean(
        data !== null &&
        data !== undefined &&
        typeof data === 'object' &&
        'ciphertext' in data &&
        typeof data.ciphertext === 'string' &&
        data.ciphertext.length > 0 &&
        'iv' in data &&
        typeof data.iv === 'string' &&
        data.iv.length > 0
    );
}

/**
 * APIキーを暗号化する（ユーティリティ関数）
 * @param {string} apiKey - APIキー
 * @param {CryptoKey} key - 暗号化キー
 * @returns {Promise<EncryptedData>} 暗号化されたAPIキー
 */
export async function encryptApiKey(apiKey: string, key: CryptoKey): Promise<EncryptedData> {
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
export async function decryptApiKey(encryptedApiKey: EncryptedData | string, key: CryptoKey): Promise<string> {
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
export async function computeHMAC(secret: string, message: string): Promise<string> {
    const webcrypto = getWebCrypto();
    const encoder = new TextEncoder();

    const secretKey = await webcrypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );

    const signature = await webcrypto.subtle.sign(
        'HMAC',
        secretKey,
        encoder.encode(message)
    );

    const signatureArray = Array.from(new Uint8Array(signature));
    return btoa(String.fromCharCode(...signatureArray));
}

/**
 * 【セキュリティ修正】PBKDF2を使用したパスワードハッシュ化
 * VULN-019 fix: 600,000 iterations (ENVELOPE_ITERATIONS) for stronger KDF
 * @param {string} password - パスワード
 * @param {Uint8Array} salt - ソルト
 * @param {number} iterations - PBKDF2 iterations (default: ENVELOPE_ITERATIONS)
 * @returns {Promise<string>} Base64エンコードされたパスワードハッシュ
 */
export async function hashPasswordWithPBKDF2(password: string, salt: Uint8Array, iterations: number = ENVELOPE_ITERATIONS): Promise<string> {
    const webcrypto = getWebCrypto();
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);

    const baseKey = await webcrypto.subtle.importKey(
        'raw',
        passwordBuffer,
        'PBKDF2',
        false,
        ['deriveBits']
    );

    const derivedBits = await webcrypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: salt as BufferSource,
            iterations,
            hash: HASH_ALGORITHM
        },
        baseKey,
        256 // 256 bits = 32 bytes
    );

    const hashArray = Array.from(new Uint8Array(derivedBits));
    return btoa(String.fromCharCode(...hashArray));
}

/**
 * Legacy PBKDF2 iteration count used before VULN-019 fix
 */
const LEGACY_PBKDF2_ITERATIONS = 100000;

/**
 * パスワードハッシュを検証する（PBKDF2）
 * VULN-019 fix: uses stored iteration count when provided (constant time).
 * Falls back to legacy iteration count for backward compatibility with
 * existing hashes that predate the KDF iteration storage.
 *
 * Timing safety: when @param iterations is provided, only one PBKDF2
 * computation is performed, eliminating the timing side channel between
 * the new and legacy iteration counts.
 *
 * @param {string} password - 検証するパスワード
 * @param {string} storedHash - 保存されているハッシュ（Base64）
 * @param {Uint8Array} salt - 使用されたソルト
 * @param {number} [iterations] - 保存されていたKDF iteration回数（あれば1回のみ計算）
 * @returns {Promise<{isValid: boolean; needsRehash: boolean}>} 検証結果と再ハッシュ必要性
 */
export async function verifyPasswordWithPBKDF2(
    password: string,
    storedHash: string,
    salt: Uint8Array,
    iterations?: number,
): Promise<{ isValid: boolean; needsRehash: boolean }> {
    if (iterations !== undefined) {
        // Constant-time path: use stored iteration count exclusively.
        const computedHash = await hashPasswordWithPBKDF2(password, salt, iterations);
        const valid = await constantTimeCompare(computedHash, storedHash);
        const effectiveIterations = iterations ?? ENVELOPE_ITERATIONS;
        return { isValid: valid, needsRehash: effectiveIterations !== ENVELOPE_ITERATIONS };
    }
    // Legacy path (no stored iterations): always compute both hashes before
    // comparing, so response time does not depend on which iteration count
    // (or neither) matches.
    const newHash = await hashPasswordWithPBKDF2(password, salt, ENVELOPE_ITERATIONS);
    const legacyHash = await hashPasswordWithPBKDF2(password, salt, LEGACY_PBKDF2_ITERATIONS);
    const newMatches = await constantTimeCompare(newHash, storedHash);
    const legacyMatches = await constantTimeCompare(legacyHash, storedHash);
    if (newMatches) {
        return { isValid: true, needsRehash: false };
    }
    if (legacyMatches) {
        return { isValid: true, needsRehash: true };
    }
    return { isValid: false, needsRehash: false };
}

/**
 * URLのSHA-256ハッシュを生成し、先頭16文字のプレフィックス付き文字列を返す
 * ログ出力時のプライバシー保護用（URLの生値を直接ログに記録しないため）
 * @param {string} url - ハッシュ化するURL
 * @returns {Promise<string>} 先頭16文字のSHA-256ハッシュ値（プレフィックス付き）
 *
 * @example
 * const hash = await hashUrl('https://example.com/path');
 * // Returns: '[hash:a1b2c3d4e5f6a7b8]'
 */
export async function hashUrl(url: string): Promise<string> {
    const webcrypto = getWebCrypto();
    const msgBuffer = new TextEncoder().encode(url);
    const hashBuffer = await webcrypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return `[hash:${hashHex.substring(0, 16)}]`;
}

export function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
