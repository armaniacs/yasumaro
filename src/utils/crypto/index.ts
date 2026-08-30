// @layer Barrel — Re-export
/**
 * crypto/index.ts
 * 暗号化ユーティリティの re-export barrel。
 *
 * 実装は責務ごとに3ファイルへ分割されている:
 * - primitives.ts   汎用AES-GCM/PBKDF2プリミティブ（副作用なし）
 * - hmacKeyStore.ts  HMAC署名鍵の生成・ラップ・永続化（chrome.storage副作用あり）
 * - envelope.ts      バージョン付き暗号化エンベロープ形式
 *
 * 既存の import 経路（'../utils/crypto/index.js' 等）を維持するための barrel。
 * 新規コードもこの barrel から import してよい。
 */

export {
    generateSalt,
    generateIV,
    constantTimeCompare,
    deriveKey,
    encrypt,
    decrypt,
    decryptData,
    isEncrypted,
    encryptApiKey,
    decryptApiKey,
    computeHMAC,
    hashPasswordWithPBKDF2,
    verifyPasswordWithPBKDF2,
    hashUrl,
    bytesToBase64,
    base64ToBytes,
    CURRENT_ENVELOPE_VERSION,
    ENVELOPE_ITERATIONS,
} from './primitives.js';

export { CRYPTO_PARAMS, validatePasswordPolicy } from './cryptoParams.js';

export {
    deriveHmacWrappingKey,
    getConsentHmacKey,
    getNotificationHmacKey,
    generateHmacSignature,
    verifyHmacSignature,
    wrapSecretString,
    unwrapSecretString,
    isWrappedSecretString,
} from './hmacKeyStore.js';

export {
    encryptEnvelope,
    decryptEnvelope,
    isEncryptionEnvelope,
    migrateLegacyCiphertext,
} from './envelope.js';
export type { EncryptionEnvelope } from './envelope.js';
