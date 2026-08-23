/**
 * crypto/hmacKeyStore.ts
 * HMAC署名鍵の管理（生成・ラップ・永続化・検証）
 *
 * chrome.storage.local / chrome.storage.session への副作用を持つ。
 * 汎用暗号プリミティブは crypto/primitives.ts を参照。
 */

import { errorMessage } from '../errorUtils.js';
import {
    getWebCrypto,
    ENVELOPE_ITERATIONS,
    bytesToBase64,
    base64ToBytes,
} from './primitives.js';

const KEY_LENGTH = 256; // bits
const IV_LENGTH = 12; // bytes (recommended for AES-GCM)

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
 * Persisted in chrome.storage.local to preserve wrapped HMAC keys across
 * browser restarts. This is necessary for privacy consent signatures to
 * remain valid after browser closure. Session storage serves as a cache.
 * @returns {Promise<CryptoKey>} AES-GCM wrapping key
 */
async function getOrCreateHmacWrappingKey(): Promise<CryptoKey> {
    const webcrypto = getWebCrypto();

    try {
        // Try session storage first (current session)
        const sessionResult = await chrome.storage.session.get(HMAC_WRAPPING_KEY_SESSION);
        const sessionStored = sessionResult[HMAC_WRAPPING_KEY_SESSION];
        if (typeof sessionStored === 'string' && sessionStored.length > 0) {
            return await webcrypto.subtle.importKey(
                'raw',
                base64ToBytes(sessionStored) as BufferSource,
                { name: 'AES-GCM', length: KEY_LENGTH },
                false,
                ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt']
            );
        }

        // Fallback to local storage (persistent across restarts)
        const localResult = await chrome.storage.local.get(HMAC_WRAPPING_KEY_SESSION);
        const localStored = localResult[HMAC_WRAPPING_KEY_SESSION];
        if (typeof localStored === 'string' && localStored.length > 0) {
            const key = await webcrypto.subtle.importKey(
                'raw',
                base64ToBytes(localStored) as BufferSource,
                { name: 'AES-GCM', length: KEY_LENGTH },
                false,
                ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt']
            );
            // Cache in session for this browser session
            await chrome.storage.session.set({ [HMAC_WRAPPING_KEY_SESSION]: localStored });
            return key;
        }
    } catch (error: unknown) {
        console.warn('Failed to load HMAC wrapping key, generating new one:', errorMessage(error));
    }

    const keyBytes = webcrypto.getRandomValues(new Uint8Array(32));
    const keyBase64 = bytesToBase64(keyBytes);
    // Store in both session and local storage
    await Promise.all([
        chrome.storage.session.set({ [HMAC_WRAPPING_KEY_SESSION]: keyBase64 }),
        chrome.storage.local.set({ [HMAC_WRAPPING_KEY_SESSION]: keyBase64 })
    ]);
    return webcrypto.subtle.importKey(
        'raw',
        keyBytes as BufferSource,
        { name: 'AES-GCM', length: KEY_LENGTH },
        false,
        ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt']
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
 * Import raw key material as an HMAC-SHA256 key
 * @param {Uint8Array} keyData - 32-byte key material
 * @param {boolean} extractable - Whether the returned key may be extracted (required for wrapKey)
 * @returns {Promise<CryptoKey>} HMAC-SHA256 signing key
 */
async function importHmacKey(keyData: Uint8Array, extractable: boolean): Promise<CryptoKey> {
    const webcrypto = getWebCrypto();
    return webcrypto.subtle.importKey(
        'raw',
        keyData as BufferSource,
        { name: 'HMAC', hash: 'SHA-256' },
        extractable,
        ['sign', 'verify']
    );
}

// Helper function for base64 -> uint8Array conversion
function base64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
    const binaryString = atob(base64);
    return Uint8Array.from(binaryString, c => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
}

/**
 * Load an HMAC key from storage, unwrapping it when stored in encrypted form.
 * Generates a new key (and stores it wrapped) when none exists or when the
 * stored value cannot be unwrapped. Callers receive a non-extractable key.
 * @param {string} storageKey - chrome.storage.local key for the wrapped key
 * @param {string} versionKey - chrome.storage.local key for the format version
 * @returns {Promise<CryptoKey>} HMAC-SHA256 signing key
 */
async function getOrCreateWrappedHmacKey(storageKey: string, versionKey: string): Promise<CryptoKey> {
    const webcrypto = getWebCrypto();

    try {
        const result = await chrome.storage.local.get([storageKey, versionKey]);
        const stored = result[storageKey];

        if (isWrappedHmacKey(stored)) {
            try {
                const wrappingKey = await getOrCreateHmacWrappingKey();
                return await unwrapHmacKey(stored.wrapped, stored.iv, wrappingKey);
            } catch (error: unknown) {
                console.warn(`Failed to unwrap HMAC key (${storageKey}), generating new one:`, errorMessage(error));
            }
        } else if (typeof stored === 'string' && stored.length > 0) {
            // Legacy plaintext key (pre-PBI-03): wrap and persist the encrypted
            // form so the raw key material is no longer exposed in storage.local.
            try {
                const keyData = base64ToUint8Array(stored);
                const wrappingKey = await getOrCreateHmacWrappingKey();
                const extractableKey = await importHmacKey(keyData, true);
                const wrapped = await wrapHmacKey(extractableKey, wrappingKey);
                await chrome.storage.local.set({ [storageKey]: wrapped, [versionKey]: '1' });
                return await importHmacKey(keyData, false);
            } catch (error: unknown) {
                console.warn(`Failed to migrate plaintext HMAC key (${storageKey}), generating new one:`, errorMessage(error));
            }
        }
    } catch (error: unknown) {
        console.warn(`Failed to load HMAC key (${storageKey}), generating new one:`, errorMessage(error));
    }

    // Generate a fresh key and persist only its wrapped form
    const keyData = webcrypto.getRandomValues(new Uint8Array(32));
    const wrappingKey = await getOrCreateHmacWrappingKey();
    const extractableKey = await importHmacKey(keyData, true);
    const wrapped = await wrapHmacKey(extractableKey, wrappingKey);
    await chrome.storage.local.set({ [storageKey]: wrapped, [versionKey]: '1' });
    return importHmacKey(keyData, false);
}

/**
 * Encrypt an arbitrary secret string (e.g. an HMAC secret used as raw key
 * material for computeHMAC) with the shared HMAC wrapping key.
 * Unlike wrapHmacKey/unwrapHmacKey (which wrap non-extractable CryptoKey
 * objects), this wraps/unwraps a plain string via AES-GCM so the caller can
 * get the original string back for use with string-based APIs.
 * @param {string} secret - Secret string to encrypt (e.g. base64 key material)
 * @returns {Promise<WrappedHmacKey>} Encrypted envelope
 */
export async function wrapSecretString(secret: string): Promise<WrappedHmacKey> {
    const webcrypto = getWebCrypto();
    const wrappingKey = await getOrCreateHmacWrappingKey();
    const iv = webcrypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const ciphertext = await webcrypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        wrappingKey,
        textEncoder.encode(secret) as BufferSource
    );
    return {
        wrapped: bytesToBase64(new Uint8Array(ciphertext)),
        iv: bytesToBase64(iv),
    };
}

/**
 * Decrypt a secret string previously encrypted with wrapSecretString.
 * @param {WrappedHmacKey} envelope - Encrypted envelope
 * @returns {Promise<string>} Original secret string
 */
export async function unwrapSecretString(envelope: WrappedHmacKey): Promise<string> {
    const webcrypto = getWebCrypto();
    const wrappingKey = await getOrCreateHmacWrappingKey();
    const plaintext = await webcrypto.subtle.decrypt(
        { name: 'AES-GCM', iv: base64ToBytes(envelope.iv) as BufferSource },
        wrappingKey,
        base64ToBytes(envelope.wrapped) as BufferSource
    );
    return new TextDecoder().decode(plaintext);
}

/**
 * Type guard for a wrapped secret envelope, shared with wrapped HMAC keys.
 */
export function isWrappedSecretString(data: unknown): data is WrappedHmacKey {
    return isWrappedHmacKey(data);
}

/**
 * Get or create HMAC signature key for privacy consent integrity checks.
 * Uses a dedicated key (separate from getNotificationHmacKey) so that key
 * rotation or compromise in one domain does not affect the other.
 * The key is stored encrypted (wrapped) in chrome.storage.local.
 * @returns {Promise<CryptoKey>} HMAC-SHA256 signing key
 */
export async function getConsentHmacKey(): Promise<CryptoKey> {
    return getOrCreateWrappedHmacKey(CONSENT_HMAC_SIGNATURE_KEY_STORAGE, CONSENT_HMAC_SIGNATURE_KEY_VERSION);
}

/**
 * Get or create HMAC signature key for notification IDs.
 * The key is stored encrypted (wrapped) in chrome.storage.local.
 * @returns {Promise<CryptoKey>} HMAC-SHA256 signing key
 */
export async function getNotificationHmacKey(): Promise<CryptoKey> {
    return getOrCreateWrappedHmacKey(HMAC_SIGNATURE_KEY_STORAGE, HMAC_SIGNATURE_KEY_VERSION);
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
            result |= (sig8[i] ?? 0) ^ (comp8[i] ?? 0);
        }
        return result === 0;
    } catch (_error: unknown) {
        return false;
    }
}
