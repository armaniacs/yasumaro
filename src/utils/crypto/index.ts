/**
 * crypto.ts
 * Web Crypto APIを使用した暗号化・復号化ユーティリティ
 * 【機能概要】: APIキーの暗号化・復号化、マスターパスワードのハッシュ化・検証
 * 【設計方針】: AES-GCM認証付き暗号化、PBKDF2キー導出
 * 【セキュリティ】: 導出キーはメモリにのみ保存、ソルトとハッシュのみを永続化
 */

import type { EncryptedData } from './types.js';
import { errorMessage } from '../errorUtils.js';

// 定数設定
const PBKDF2_ITERATIONS = 100000;
const KEY_LENGTH = 256; // bits
const SALT_LENGTH = 16; // bytes
const IV_LENGTH = 12; // bytes (recommended for AES-GCM)
const HASH_ALGORITHM = 'SHA-256';
const ENCRYPTION_ALGORITHM = 'AES-GCM';

// Versioned Encryption Envelope (H3) constants
// Declared at the top so every function (e.g. hashPasswordWithPBKDF2,
// verifyPasswordWithPBKDF2) can reference them without TDZ hazards.
export const CURRENT_ENVELOPE_VERSION = 2;
export const ENVELOPE_ITERATIONS = 600_000;
const ENVELOPE_HASH: 'SHA-256' = 'SHA-256';
const MAX_ENVELOPE_ITERATIONS = ENVELOPE_ITERATIONS * 10;
const MIN_ENVELOPE_ITERATIONS = 1;
const MAX_ENVELOPE_BASE64_LENGTH = 10 * 1024 * 1024;
const ALLOWED_ENVELOPE_HASHES = ['SHA-256'] as const;

/**
 * Web Crypto APIのインスタンスを取得する
 * global.crypto.subtleが利用可能ならglobal.cryptoを使用し、なければcryptoを使用
 * @returns {Crypto} Web Crypto APIインスタンス
 */
function getWebCrypto(): Crypto {
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
 * SHA-256 password hashing (no salt).
 * @deprecated Use hashPasswordWithPBKDF2() instead. SHA-256 without salt is insecure.
 * Kept internal-only (not exported) since no production code should use this.
 */
async function _hashPasswordDeprecated(password: string): Promise<string> {
    const webcrypto = getWebCrypto();
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await webcrypto.subtle.digest(HASH_ALGORITHM, data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return btoa(String.fromCharCode(...hashArray));
}

/**
 * Password verification using deprecated SHA-256 (no salt).
 * @deprecated Use verifyPasswordWithPBKDF2() instead.
 * Kept internal-only (not exported) since no production code should use this.
 */
async function _verifyPasswordDeprecated(password: string, hash: string): Promise<boolean> {
    const computedHash = await _hashPasswordDeprecated(password);
    return constantTimeCompare(computedHash, hash);
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

// ============================================================================
// Notification Security Utils for HMAC Key Management
// ============================================================================

const HMAC_SIGNATURE_KEY_STORAGE = 'notification-signature-key';
const HMAC_SIGNATURE_KEY_VERSION = '1'; // Version tracking for key rotation
const CONSENT_HMAC_SIGNATURE_KEY_STORAGE = 'privacy-consent-signature-key';
const CONSENT_HMAC_SIGNATURE_KEY_VERSION = '1'; // Version tracking for key rotation
const textEncoder = new TextEncoder();

// ============================================================================
// HMAC Key Wrapping (PBI-03: never store HMAC keys as plaintext base64)
// ============================================================================
// HMAC signing keys are wrapped with an AES-GCM key (KEK) and only the
// { wrapped, iv } envelope is persisted in chrome.storage.local. The KEK is
// stored in chrome.storage.session, which is not readable from the local
// storage area alone and is cleared when the browser closes.

const HMAC_WRAPPING_KEY_SESSION = 'hmac-wrapping-key';

interface WrappedHmacKey {
    wrapped: string;
    iv: string;
}

function isWrappedHmacKey(data: unknown): data is WrappedHmacKey {
    return Boolean(
        data !== null &&
        data !== undefined &&
        typeof data === 'object' &&
        'wrapped' in data &&
        typeof (data as WrappedHmacKey).wrapped === 'string' &&
        (data as WrappedHmacKey).wrapped.length > 0 &&
        'iv' in data &&
        typeof (data as WrappedHmacKey).iv === 'string' &&
        (data as WrappedHmacKey).iv.length > 0
    );
}

/**
 * Derive a wrapping key (KEK) from a password using PBKDF2.
 * Intended for the master-password path: the derived key is stable across
 * sessions, so wrapped HMAC keys remain decryptable after a browser restart
 * (once the user unlocks). The default path (no master password) uses
 * getOrCreateHmacWrappingKey() instead.
 * @param {string} password - Master password
 * @param {Uint8Array} salt - Per-user salt
 * @returns {Promise<CryptoKey>} AES-GCM wrapping key
 */
export async function deriveHmacWrappingKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const webcrypto = getWebCrypto();
    const encoder = new TextEncoder();
    const baseKey = await webcrypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        'PBKDF2',
        false,
        ['deriveKey']
    );
    return webcrypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt as BufferSource,
            iterations: ENVELOPE_ITERATIONS,
            hash: 'SHA-256'
        },
        baseKey,
        { name: 'AES-GCM', length: KEY_LENGTH },
        false,
        ['wrapKey', 'unwrapKey']
    );
}

/**
 * Get (or create) the session-scoped HMAC wrapping key.
 * Persisted in chrome.storage.session so that reading chrome.storage.local
 * alone does not expose the wrapped HMAC keys. Lost when the browser closes —
 * acceptable tradeoff: HMAC keys are re-created on the next launch.
 * @returns {Promise<CryptoKey>} AES-GCM wrapping key
 */
async function getOrCreateHmacWrappingKey(): Promise<CryptoKey> {
    const webcrypto = getWebCrypto();

    try {
        const result = await chrome.storage.session.get(HMAC_WRAPPING_KEY_SESSION);
        const stored = result[HMAC_WRAPPING_KEY_SESSION];
        if (typeof stored === 'string' && stored.length > 0) {
            return await webcrypto.subtle.importKey(
                'raw',
                base64ToBytes(stored) as BufferSource,
                { name: 'AES-GCM', length: KEY_LENGTH },
                false,
                ['wrapKey', 'unwrapKey']
            );
        }
    } catch (error: unknown) {
        console.warn('Failed to load HMAC wrapping key, generating new one:', errorMessage(error));
    }

    const keyBytes = webcrypto.getRandomValues(new Uint8Array(32));
    await chrome.storage.session.set({ [HMAC_WRAPPING_KEY_SESSION]: bytesToBase64(keyBytes) });
    return webcrypto.subtle.importKey(
        'raw',
        keyBytes as BufferSource,
        { name: 'AES-GCM', length: KEY_LENGTH },
        false,
        ['wrapKey', 'unwrapKey']
    );
}

/**
 * Wrap an HMAC key with the given wrapping key (AES-GCM).
 * @returns {Promise<WrappedHmacKey>} Base64 wrapped key material and IV
 */
async function wrapHmacKey(key: CryptoKey, wrappingKey: CryptoKey): Promise<WrappedHmacKey> {
    const webcrypto = getWebCrypto();
    const iv = webcrypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const wrapped = await webcrypto.subtle.wrapKey(
        'raw',
        key,
        wrappingKey,
        { name: 'AES-GCM', iv: iv as BufferSource }
    );
    return {
        wrapped: bytesToBase64(new Uint8Array(wrapped)),
        iv: bytesToBase64(iv),
    };
}

/**
 * Unwrap an HMAC key previously wrapped with wrapHmacKey.
 * @returns {Promise<CryptoKey>} Non-extractable HMAC-SHA256 key (sign/verify)
 */
async function unwrapHmacKey(wrapped: string, iv: string, wrappingKey: CryptoKey): Promise<CryptoKey> {
    const webcrypto = getWebCrypto();
    return webcrypto.subtle.unwrapKey(
        'raw',
        base64ToBytes(wrapped) as BufferSource,
        wrappingKey,
        { name: 'AES-GCM', iv: base64ToBytes(iv) as BufferSource },
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify']
    );
}

/**
 * Get or create HMAC signature key for privacy consent integrity checks.
 * Uses a dedicated key (separate from getNotificationHmacKey) so that key
 * rotation or compromise in one domain does not affect the other.
 * @returns {Promise<CryptoKey>} HMAC-SHA256 signing key
 */
export async function getConsentHmacKey(): Promise<CryptoKey> {
    const webcrypto = getWebCrypto();

    try {
        const result = await chrome.storage.local.get([
            CONSENT_HMAC_SIGNATURE_KEY_STORAGE,
            CONSENT_HMAC_SIGNATURE_KEY_VERSION
        ]);

        const storedKeyData = result[CONSENT_HMAC_SIGNATURE_KEY_STORAGE];
        if (typeof storedKeyData === 'string' && storedKeyData.length > 0) {
            const keyData = base64ToUint8Array(storedKeyData);
            return await webcrypto.subtle.importKey(
                'raw',
                keyData,
                { name: 'HMAC', hash: 'SHA-256' },
                false,
                ['sign', 'verify']
            );
        }
    } catch (error: unknown) {
        console.warn('Failed to load consent HMAC key, generating new one:', errorMessage(error));
    }

    const keyData = webcrypto.getRandomValues(new Uint8Array(32));
    const keyBase64 = uint8ArrayToBase64(keyData);
    await chrome.storage.local.set({
        [CONSENT_HMAC_SIGNATURE_KEY_STORAGE]: keyBase64,
        [CONSENT_HMAC_SIGNATURE_KEY_VERSION]: '1'
    });

    return await webcrypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify']
    );
}

/**
 * Get or create HMAC signature key for notification IDs
 * @returns {Promise<CryptoKey>} HMAC-SHA256 signing key
 */
export async function getNotificationHmacKey(): Promise<CryptoKey> {
    const webcrypto = getWebCrypto();

    // Try to load encrypted key from storage
    try {
        const result = await chrome.storage.local.get([
            HMAC_SIGNATURE_KEY_STORAGE,
            HMAC_SIGNATURE_KEY_VERSION
        ]);

        const storedKeyData = result[HMAC_SIGNATURE_KEY_STORAGE];
        if (typeof storedKeyData === 'string' && storedKeyData.length > 0) {
            const keyData = base64ToUint8Array(storedKeyData);
            return await webcrypto.subtle.importKey(
                'raw',
                keyData,
                { name: 'HMAC', hash: 'SHA-256' },
                false,
                ['sign', 'verify']
            );
        }
    } catch (error: unknown) {
        // If loading fails, we'll generate a new key
        console.warn('Failed to load HMAC key, generating new one:', errorMessage(error));
    }

    // Generate new key and store as base64 (storage is extension-scoped, no additional encryption needed)
    const keyData = webcrypto.getRandomValues(new Uint8Array(32));
    const keyBase64 = uint8ArrayToBase64(keyData);
    await chrome.storage.local.set({
        [HMAC_SIGNATURE_KEY_STORAGE]: keyBase64,
        [HMAC_SIGNATURE_KEY_VERSION]: '1'
    });

    return await webcrypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify']
    );
}

/**
 * Generate URL-safe base64 HMAC signature for notification IDs
 * Uses full signature (no truncation) for cryptographic guarantee
 * @param {string} data - Data to sign (typically URL)
 * @param {CryptoKey} key - HMAC key
 * @returns {Promise<string>} URL-safe base64 encoded full signature
 */
export async function generateHmacSignature(data: string, key: CryptoKey): Promise<string> {
    const webcrypto = getWebCrypto();
    const dataArray = textEncoder.encode(data);
    const signature = await webcrypto.subtle.sign('HMAC', key, dataArray) as ArrayBuffer;
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
export async function verifyHmacSignature(data: string, signature: string, key: CryptoKey): Promise<boolean> {
    try {
        const computedSignature = await generateHmacSignature(data, key);

        // Use constantTimeCompare if available (from crypto.ts)
        const encoder = textEncoder;
        const sigBuf = encoder.encode(signature);
        const compBuf = encoder.encode(computedSignature);

        // Check length mismatch first (timing-safe via length comparison)
        if (sigBuf.byteLength !== compBuf.byteLength) {
            return false;
        }

        // Manual constant-time comparison
        let result = 0;
        const sig8 = new Uint8Array(sigBuf);
        const comp8 = new Uint8Array(compBuf);
        for (let i = 0; i < sigBuf.byteLength; i++) {
            result |= sig8[i] ^ comp8[i];
        }
        return result === 0;
    } catch (_error: unknown) {
        return false;
    }
}

// Helper functions for uint8Array <-> base64 conversion
function uint8ArrayToBase64(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes));
}

function base64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
    const binaryString = atob(base64);
    return Uint8Array.from(binaryString, c => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
}

// ============================================================================
// Privacy Utils for Hash-Based Logging
// ============================================================================

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
    const msgBuffer = textEncoder.encode(url);
    const hashBuffer = await webcrypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return `[hash:${hashHex.substring(0, 16)}]`;
}

// ============================================================================
// Versioned Encryption Envelope (H3)
// ============================================================================

export interface EncryptionEnvelope {
    version: number;
    kdf: 'pbkdf2';
    hash: string;
    iterations: number;
    salt: string;
    iv: string;
    data: string;
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function validateEnvelope(envelope: EncryptionEnvelope): void {
    if (envelope.version !== CURRENT_ENVELOPE_VERSION) {
        throw new Error(`Unsupported envelope version: ${envelope.version}. Expected ${CURRENT_ENVELOPE_VERSION}.`);
    }
    if (envelope.iterations < MIN_ENVELOPE_ITERATIONS || envelope.iterations > MAX_ENVELOPE_ITERATIONS) {
        throw new Error(`Invalid envelope iterations: ${envelope.iterations}`);
    }
    if (!ALLOWED_ENVELOPE_HASHES.includes(envelope.hash as typeof ALLOWED_ENVELOPE_HASHES[number])) {
        throw new Error(`Invalid envelope hash: ${envelope.hash}`);
    }
    for (const field of ['salt', 'iv', 'data'] as const) {
        if (envelope[field].length > MAX_ENVELOPE_BASE64_LENGTH) {
            throw new Error(`Envelope ${field} exceeds maximum length`);
        }
    }
}

export async function encryptEnvelope(plaintext: string, password: string): Promise<EncryptionEnvelope> {
    const salt = generateSalt();
    const iv = generateIV();
    const key = await deriveKey(password, salt, ENVELOPE_ITERATIONS, ENVELOPE_HASH);
    const webcrypto = getWebCrypto();
    const ciphertext = await webcrypto.subtle.encrypt(
        { name: ENCRYPTION_ALGORITHM, iv: iv as BufferSource },
        key,
        new TextEncoder().encode(plaintext),
    );
    return {
        version: CURRENT_ENVELOPE_VERSION,
        kdf: 'pbkdf2',
        hash: ENVELOPE_HASH,
        iterations: ENVELOPE_ITERATIONS,
        salt: bytesToBase64(salt),
        iv: bytesToBase64(iv),
        data: bytesToBase64(new Uint8Array(ciphertext)),
    };
}

export async function decryptEnvelope(envelope: EncryptionEnvelope, password: string): Promise<string> {
    validateEnvelope(envelope);
    const salt = base64ToBytes(envelope.salt);
    const iv = base64ToBytes(envelope.iv);
    const ciphertext = base64ToBytes(envelope.data);
    const key = await deriveKey(password, salt, envelope.iterations, envelope.hash);
    const webcrypto = getWebCrypto();
    const plaintext = await webcrypto.subtle.decrypt(
        { name: ENCRYPTION_ALGORITHM, iv: iv as BufferSource },
        key,
        ciphertext as BufferSource,
    );
    return new TextDecoder().decode(plaintext);
}

export function isEncryptionEnvelope(data: unknown): data is EncryptionEnvelope {
    if (!data || typeof data !== 'object') return false;
    const d = data as Record<string, unknown>;
    if (typeof d.iterations !== 'number' || d.iterations < MIN_ENVELOPE_ITERATIONS || d.iterations > MAX_ENVELOPE_ITERATIONS) {
        return false;
    }
    if (typeof d.hash !== 'string' || !ALLOWED_ENVELOPE_HASHES.includes(d.hash as typeof ALLOWED_ENVELOPE_HASHES[number])) {
        return false;
    }
    return (
        typeof d.version === 'number' &&
        d.version === CURRENT_ENVELOPE_VERSION &&
        d.kdf === 'pbkdf2' &&
        typeof d.salt === 'string' &&
        typeof d.iv === 'string' &&
        typeof d.data === 'string'
    );
}

export async function migrateLegacyCiphertext(
    legacyData: EncryptedData,
    legacyKey: CryptoKey,
    password: string,
): Promise<EncryptionEnvelope> {
    const plaintext = await decryptData(legacyData, legacyKey);
    return encryptEnvelope(plaintext, password);
}