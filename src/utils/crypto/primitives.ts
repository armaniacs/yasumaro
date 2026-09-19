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
import { CRYPTO_PARAMS } from './cryptoParams.js';

// 定数設定 — SSOT via cryptoParams.ts
const PBKDF2_ITERATIONS = CRYPTO_PARAMS.PBKDF2_ITERATIONS;
const KEY_LENGTH = 256; // bits
const IV_LENGTH = 12; // bytes (recommended for AES-GCM)
const HASH_ALGORITHM = 'SHA-256';
const ENCRYPTION_ALGORITHM = 'AES-GCM';
const SALT_LENGTH = 16; // bytes

// Versioned Encryption Envelope (H3) constants
// Declared here (not in envelope.ts) so hashPasswordWithPBKDF2 /
// verifyPasswordWithPBKDF2 can reference them without TDZ hazards, and so
// envelope.ts can import them alongside deriveKey.
// Values are SSOT-re-exported from cryptoParams for backward compatibility.
export const CURRENT_ENVELOPE_VERSION = CRYPTO_PARAMS.ENVELOPE_VERSION;
export const ENVELOPE_ITERATIONS = CRYPTO_PARAMS.PBKDF2_ITERATIONS;

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

    const ciphertextArray = new Uint8Array(ciphertextBuffer);
    const ivBytes = iv;

    return {
        ciphertext: bytesToBase64(ciphertextArray),
        iv: bytesToBase64(ivBytes)
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
        const ciphertextArray = base64ToBytes(ciphertext);
        const ivArray = base64ToBytes(iv);

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
 *
 * @deprecated 新しい呼び出しでは HmacSigner を使うこと
 * （crypto/hmacSigner.ts の `hmacSignerForSecret`、または用途別の
 * `exportHmacSigner` / `consentHmacSigner` / `notificationHmacSigner`）。
 * こちらは検証時の定数時間比較を呼び出し側任せにするため、書き忘れると
 * タイミング攻撃の穴になる。本番の呼び出しは PBI 2026-09-16-04 で全て
 * 移行済みで、残っているのは互換のための公開のみ。
 * Sunset: remove in next major (re-evaluate 2026-12-31).
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

    return bytesToBase64(new Uint8Array(signature));
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

    return bytesToBase64(new Uint8Array(derivedBits));
}

/**
 * Legacy PBKDF2 iteration count used before VULN-019 fix — SSOT
 */
const LEGACY_PBKDF2_ITERATIONS = CRYPTO_PARAMS.LEGACY_PBKDF2_ITERATIONS;

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
 * Chunk size for the byte→binary-string step, in bytes.
 *
 * `String.fromCharCode.apply` passes every byte as a separate argument, so a
 * whole multi-megabyte array in one call overflows the argument stack. 32 KiB
 * stays well inside every engine's limit while keeping the number of calls —
 * and the intermediate strings that must be joined — small.
 */
const BASE64_CHUNK_BYTES = 0x8000;

/**
 * Encode raw bytes as base64.
 *
 * Chunked rather than appending one character at a time: the per-character
 * loop this replaced spent its time growing an ever-longer string, measuring
 * ~106ms against ~39ms for 2 MiB. Callers that serialize whole structures
 * (the Bloom filter, DB exports) are the ones that feel it.
 */
export function bytesToBase64(bytes: Uint8Array): string {
    const chunks: string[] = [];
    for (let i = 0; i < bytes.length; i += BASE64_CHUNK_BYTES) {
        const chunk = bytes.subarray(i, i + BASE64_CHUNK_BYTES);
        chunks.push(String.fromCharCode.apply(null, Array.from(chunk) as number[]));
    }
    return btoa(chunks.join(''));
}

/** Decode base64 back to the raw bytes `bytesToBase64` was given. */
export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

/**
 * Encode text as base64, via UTF-8.
 *
 * Separate from `bytesToBase64` because the inputs are not interchangeable:
 * `btoa` rejects any code point above U+00FF, so text has to be encoded to
 * UTF-8 bytes first. Callers that reached for `btoa` directly had to remember
 * that themselves — usually spelled `btoa(unescape(encodeURIComponent(s)))`,
 * which relies on the deprecated `unescape`.
 */
export function textToBase64(text: string): string {
    return bytesToBase64(new TextEncoder().encode(text));
}

/** Decode base64 produced by `textToBase64` back to text. */
export function base64ToText(b64: string): string {
    return new TextDecoder().decode(base64ToBytes(b64));
}

/**
 * Encode bytes as base64url (RFC 4648 §5): `-` and `_` instead of `+` and `/`,
 * with the `=` padding stripped.
 *
 * Used where the value travels inside a URL — notification payloads and the
 * HMAC signatures that authenticate them. Kept beside the standard codec so
 * the substitution is written once; call sites used to repeat the same three
 * `.replace()` calls and had to remember that omitting any of them produces a
 * string that breaks when parsed back out of a URL.
 */
export function bytesToBase64Url(bytes: Uint8Array): string {
    return bytesToBase64(bytes)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

/** Encode text as base64url, via UTF-8. */
export function textToBase64Url(text: string): string {
    return bytesToBase64Url(new TextEncoder().encode(text));
}

/**
 * Decode base64url back to bytes, restoring the padding `bytesToBase64Url`
 * stripped. Plain base64 also decodes correctly, since only the two
 * substituted characters differ.
 */
export function base64UrlToBytes(b64url: string): Uint8Array<ArrayBuffer> {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    // Base64 encodes 3 bytes per 4 characters, so a complete string is always
    // a multiple of 4; pad whatever the stripping removed.
    const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, '=');
    return base64ToBytes(padded);
}

/** Decode base64url produced by `textToBase64Url` back to text. */
export function base64UrlToText(b64url: string): string {
    return new TextDecoder().decode(base64UrlToBytes(b64url));
}
