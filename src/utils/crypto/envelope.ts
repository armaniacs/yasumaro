/**
 * crypto/envelope.ts
 * バージョン付き暗号化エンベロープ形式（H3）
 *
 * パスワードベースの暗号化・復号を単一の自己記述的な構造体
 * （バージョン・KDF種別・iteration数・salt・iv・data）にまとめる。
 * 汎用暗号プリミティブは crypto/primitives.ts を参照。
 */

import type { EncryptedData } from './types.js';
import {
    MAX_ENVELOPE_BASE64_LENGTH as LIMIT_ENVELOPE_BASE64_LENGTH,
    MAX_BACKUP_ENVELOPE_BASE64_LENGTH as LIMIT_BACKUP_ENVELOPE_BASE64_LENGTH,
} from '../limits.js';
import {
    getWebCrypto,
    generateSalt,
    generateIV,
    deriveKey,
    decryptData,
    CURRENT_ENVELOPE_VERSION,
    ENVELOPE_ITERATIONS,
    MAX_KDF_ITERATIONS,
    bytesToBase64,
    base64ToBytes,
} from './primitives.js';

const ENCRYPTION_ALGORITHM = 'AES-GCM';
const ENVELOPE_HASH: 'SHA-256' = 'SHA-256';
const MIN_ENVELOPE_ITERATIONS = 1;
const ALLOWED_ENVELOPE_HASHES = ['SHA-256'] as const;

export interface EncryptionEnvelope {
    version: number;
    kdf: 'pbkdf2';
    hash: string;
    iterations: number;
    salt: string;
    iv: string;
    data: string;
}

/**
 * Decrypt-side options (PBI 2026-11-06-02).
 *
 * `context: 'backup'` selects the backup-specific pre-decode cap
 * (MAX_BACKUP_ENVELOPE_BASE64_LENGTH): a user-picked backup file is already
 * bounded by MAX_BACKUP_FILE_BYTES, so its envelope may legitimately exceed
 * the generic 10 MiB cap. The default context keeps the generic cap, so all
 * other envelope consumers retain their VULN-036 budget unchanged.
 */
export interface EnvelopeDecryptOptions {
    context?: 'default' | 'backup';
    /**
     * Explicit pre-decode base64 cap override. Wins over `context`; exists so
     * boundary tests can exercise the gate without multi-megabyte fixtures.
     */
    maxBase64Length?: number;
}

export function resolveEnvelopeBase64Cap(options?: EnvelopeDecryptOptions): number {
    if (options?.maxBase64Length !== undefined) return options.maxBase64Length;
    if (options?.context === 'backup') return LIMIT_BACKUP_ENVELOPE_BASE64_LENGTH;
    return LIMIT_ENVELOPE_BASE64_LENGTH;
}

function validateEnvelope(envelope: EncryptionEnvelope, maxBase64Length: number, capLabel: string): void {
    if (envelope.version !== CURRENT_ENVELOPE_VERSION) {
        throw new Error(`Unsupported envelope version: ${envelope.version}. Expected ${CURRENT_ENVELOPE_VERSION}.`);
    }
    if (envelope.iterations < MIN_ENVELOPE_ITERATIONS || envelope.iterations > MAX_KDF_ITERATIONS) {
        throw new Error(`Invalid envelope iterations: ${envelope.iterations}`);
    }
    if (!ALLOWED_ENVELOPE_HASHES.includes(envelope.hash as typeof ALLOWED_ENVELOPE_HASHES[number])) {
        throw new Error(`Invalid envelope hash: ${envelope.hash}`);
    }
    for (const field of ['salt', 'iv', 'data'] as const) {
        if (envelope[field].length > maxBase64Length) {
            throw new Error(`Envelope ${field} exceeds maximum length (${capLabel} limit ${maxBase64Length} chars)`);
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

export async function decryptEnvelope(
    envelope: EncryptionEnvelope,
    password: string,
    options?: EnvelopeDecryptOptions,
): Promise<string> {
    // cheap-auth-first order is load-bearing (VULN-036): structural checks and
    // the pre-decode length gate run before base64 decode, KDF, and AES-GCM
    // auth decrypt. The backup context only swaps which named cap the gate
    // uses; it never moves the gate behind the expensive steps.
    const cap = resolveEnvelopeBase64Cap(options);
    const isBackupCap = options?.context === 'backup' && options?.maxBase64Length === undefined;
    validateEnvelope(envelope, cap, isBackupCap ? 'backup' : 'envelope');
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

/**
 * Backup-path decrypt (PBI 2026-11-06-02): same cheap-auth-first checks as
 * decryptEnvelope, but the pre-decode length gate uses the backup-specific
 * cap so a legitimate multi-MB backup is not rejected before authentication.
 */
export async function decryptBackupEnvelope(
    envelope: EncryptionEnvelope,
    password: string,
): Promise<string> {
    return decryptEnvelope(envelope, password, { context: 'backup' });
}

export function isEncryptionEnvelope(data: unknown): data is EncryptionEnvelope {
    if (!data || typeof data !== 'object') return false;
    const d = data as Record<string, unknown>;
    if (typeof d.iterations !== 'number' || d.iterations < MIN_ENVELOPE_ITERATIONS || d.iterations > MAX_KDF_ITERATIONS) {
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
