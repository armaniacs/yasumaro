// @layer 1 — Infrastructure (depends on Layer 0 only)
/**
 * storage/encryptionSession.ts
 * Master password lifecycle, encryption key derivation, and HMAC secret
 * management. Split out of storage.ts (PBI: storage.ts deepening).
 */

import { logInfo, logDebug } from '../logger.js';
import { CURRENT_PROTOCOL_VERSION } from '../../messaging/protocol.js';
import { calculatePasswordStrength } from '../masterPassword.js';
import {
    generateSalt,
    deriveKey,
    hashPasswordWithPBKDF2,
    verifyPasswordWithPBKDF2,
    ENVELOPE_ITERATIONS,
    wrapSecretString,
    unwrapSecretString,
    isWrappedSecretString,
} from '../crypto/index.js';
import { StorageKeys } from './types.js';
import { checkRateLimit, recordFailedAttempt, resetFailedAttempts } from '../rateLimiter.js';
import { Mutex } from '../Mutex.js';

// ============================================================================
// Module-private session state
// ============================================================================

let cachedEncryptionKey: CryptoKey | null = null;
let cachedMasterPassword: string | null = null; // セッション中のマスターパスワードキャッシュ
let isMasterPasswordRequired = false; // マスターパスワードが設定済みかどうか
let cachedHmacSecret: string | null = null;
// getOrCreateEncryptionKey の session→local 復元・新規secret生成を排他制御する。
// アップデート直後に複数のメッセージハンドラからほぼ同時に呼ばれた場合、
// この区間をロックしないと片方が誤って新しいsecretを生成し、既存の
// 暗号化済みAPIキーが復号不能になる（2026-08-12インシデントの再発防止）。
const encryptionKeyMutex = new Mutex();

// ============================================================================
// Helpers
// ============================================================================

function base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

/**
 * パスワードから暗号化キーを導出する（PBKDF2、extensionIdなし）
 * マスターパスワード方式専用
 * VULN-019 fix: uses stored iteration count with fallback to legacy
 */
async function deriveKeyFromPassword(password: string, salt: Uint8Array): Promise<CryptoKey> {
    // VULN-019 fix: use stored iteration count or ENVELOPE_ITERATIONS for new setups
    const kdfResult = await chrome.storage.local.get([StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS]);
    const iterations = (kdfResult[StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS] as number) || ENVELOPE_ITERATIONS;
    const webcrypto = global.crypto || crypto;
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);

    const baseKey = await webcrypto.subtle.importKey(
        'raw',
        passwordBuffer,
        'PBKDF2',
        false,
        ['deriveKey']
    );

    return webcrypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt as BufferSource,
            iterations,
            hash: 'SHA-256'
        },
        baseKey,
        {
            name: 'AES-GCM',
            length: 256
        },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * マスターパスワードからキーを導出する（マスターパスワード方式専用の分岐）。
 * @throws {Error} マスターパスワード未入力、またはsaltが破損している場合
 */
async function deriveKeyFromMasterPassword(passwordSaltBase64: string | undefined): Promise<CryptoKey> {
    // 【セキュリティ修正】マスターパスワードが設定されている場合は強制的にロック
    isMasterPasswordRequired = true;

    if (!cachedMasterPassword) {
        throw new Error('ENCRYPTION_LOCKED: Master password required');
    }
    if (!passwordSaltBase64) {
        throw new Error('CORRUPTION: Master password salt missing');
    }

    const passwordSalt = base64ToUint8Array(passwordSaltBase64);
    // PBKDF2キー導出を直接使用（マスターパスワードベース）
    // セッションタイムアウトチェックを開始（まだ開始していない場合）
    // Note: Session timeoutはchrome.alarms APIに移行済み（sessionAlarmsManager.ts）
    return deriveKeyFromPassword(cachedMasterPassword, passwordSalt);
}

/**
 * 直前のバージョンでsession storageに一時的に移されたsecretを、まだSWコンテキストが
 * 生きていてsession storageが失われていない間にlocalへ復元する（救済マイグレーション）。
 * アップデートを跨いでsession storageが既にクリアされてしまったユーザーは復旧できない
 * （＝暗号化済みAPIキーの再入力が必要）。
 * @returns 復元できた場合はsecret、できなかった場合はundefined
 */
async function restoreSecretFromSessionIfPresent(): Promise<string | undefined> {
    if (!chrome.storage.session) return undefined;

    const sessionResult = await chrome.storage.session.get(StorageKeys.ENCRYPTION_SECRET);
    const sessionSecret = sessionResult[StorageKeys.ENCRYPTION_SECRET] as string | undefined;
    if (!sessionSecret) return undefined;

    await chrome.storage.local.set({
        [StorageKeys.ENCRYPTION_SECRET]: sessionSecret
    });
    await chrome.storage.session.remove(StorageKeys.ENCRYPTION_SECRET);
    return sessionSecret;
}

/** 初回: ランダムなソルトとシークレットを生成してlocalに保存する。 */
async function generateAndPersistSecret(): Promise<{ saltBase64: string; secret: string }> {
    const salt = generateSalt();
    const saltBase64 = btoa(String.fromCharCode(...salt));
    // 32バイトのランダムシークレットを生成
    const secretBytes = crypto.getRandomValues(new Uint8Array(32));
    const secret = btoa(String.fromCharCode(...secretBytes));

    await chrome.storage.local.set({
        [StorageKeys.ENCRYPTION_SALT]: saltBase64,
        [StorageKeys.ENCRYPTION_SECRET]: secret
    });

    return { saltBase64, secret };
}

/**
 * マスターパスワード未設定時のキー取得（従来方式、マイグレーション準備）。
 *
 * 【重要】ENCRYPTION_SECRET は chrome.storage.local に保存する。
 * chrome.storage.session は拡張機能のアップデート時にクリアされる
 * ("session" storage area, cleared on extension update per Chrome's
 * Storage API contract) ため、ここに秘密を置くと updateのたびに
 * 秘密が失われ、既存の暗号化済みAPIキー（Obsidian/AI providerの
 * トークン）が復号不能になりデータロスを引き起こす（2026-08-12
 * インシデント: v6.7.42アップデート後にAPIキーが消失した報告）。
 *
 * session→local復元と新規secret生成は排他制御する。ロック待ち中に
 * 別の呼び出しが復元・生成を完了させている可能性があるため、ロック
 * 取得後は必ず chrome.storage.local を読み直す（ダブルチェック）。
 */
async function getOrCreateAnonymousSecretKey(): Promise<CryptoKey> {
    await encryptionKeyMutex.acquire();
    try {
        // 別の呼び出しがロック内で既にキー導出（PBKDF2, ~100k iterations）を
        // 完了させている場合、そのキャッシュを再利用して重複導出を避ける。
        if (cachedEncryptionKey) {
            return cachedEncryptionKey;
        }

        const recheck = await chrome.storage.local.get([
            StorageKeys.ENCRYPTION_SALT,
            StorageKeys.ENCRYPTION_SECRET,
        ]);
        let saltBase64 = recheck[StorageKeys.ENCRYPTION_SALT] as string;
        let secret = recheck[StorageKeys.ENCRYPTION_SECRET] as string;

        if (saltBase64 && !secret) {
            secret = (await restoreSecretFromSessionIfPresent()) ?? secret;
        }

        if (!saltBase64 || !secret) {
            ({ saltBase64, secret } = await generateAndPersistSecret());
        }

        const salt = base64ToUint8Array(saltBase64);

        // ランダムなsecretとsaltからPBKDF2でキー導出
        cachedEncryptionKey = await deriveKey(secret, salt);
        return cachedEncryptionKey;
    } finally {
        encryptionKeyMutex.release();
    }
}

// ============================================================================
// Public interface
// ============================================================================

/**
 * 暗号化キーを取得または作成する
 *
 * 【セキュリティ修正】マスターパスワードが設定されている場合、マスターパスワードからキーを導出
 * マスターパスワード未設定の場合は従来の方式でマイグレーション準備
 *
 * @returns {Promise<CryptoKey>} 導出された暗号化キー
 * @throws {Error} ロックされている場合（マスターパスワード未入力）
 */
export async function getOrCreateEncryptionKey(): Promise<CryptoKey> {
    // VULN-017 fix: check IS_LOCKED before returning cached key.
    // Only applies when a master password is actually configured — IS_LOCKED
    // is meaningless (and must not block decryption) for users who never set one.
    if (cachedEncryptionKey) {
        const lockStatus = await chrome.storage.local.get([
            StorageKeys.MASTER_PASSWORD_ENABLED,
            StorageKeys.IS_LOCKED
        ]);
        if (lockStatus[StorageKeys.MASTER_PASSWORD_ENABLED] && lockStatus[StorageKeys.IS_LOCKED]) {
            cachedEncryptionKey = null;
            cachedMasterPassword = null;
            throw new Error('ENCRYPTION_LOCKED: Session is locked');
        }
        return cachedEncryptionKey;
    }

    // マスターパスワード設定状態を確認
    const result = await chrome.storage.local.get([
        StorageKeys.MASTER_PASSWORD_ENABLED,
        StorageKeys.MASTER_PASSWORD_SALT,
    ]);

    const masterPasswordEnabled = result[StorageKeys.MASTER_PASSWORD_ENABLED] as boolean;

    if (masterPasswordEnabled) {
        cachedEncryptionKey = await deriveKeyFromMasterPassword(result[StorageKeys.MASTER_PASSWORD_SALT] as string | undefined);
        return cachedEncryptionKey;
    }

    return getOrCreateAnonymousSecretKey();
}

/**
 * マスターパスワードが設定されているか確認
 * @returns {Promise<boolean>} マスターパスワードが設定済みの場合true
 */
export async function isMasterPasswordEnabled(): Promise<boolean> {
    const result = await chrome.storage.local.get(StorageKeys.MASTER_PASSWORD_ENABLED);
    return Boolean(result[StorageKeys.MASTER_PASSWORD_ENABLED]);
}

/**
 * 暗号化がロックされているか確認（マスターパスワード未入力）
 * @returns {Promise<boolean>} ロックされている場合true
 */
export async function isEncryptionLocked(): Promise<boolean> {
    const enabled = await isMasterPasswordEnabled();
    return isMasterPasswordRequired && enabled && !cachedMasterPassword;
}

/**
 * マスターパスワードを設定する
 * @param {string} password - マスターパスワード
 * @returns {Promise<boolean>} 成功した場合true
 */
export async function setMasterPassword(password: string): Promise<boolean> {
    if (!password || password.length < 8) {
        throw new Error('Password must be at least 8 characters');
    }

    // 【セキュリティ改善】パスワード強度チェック
    const strength = calculatePasswordStrength(password);
    if (strength.score < 40) {
        throw new Error(
            `Password is too weak (score: ${strength.score}, level: ${strength.level}). Please include a mix of uppercase, lowercase, numbers, and special characters.`
        );
    }

    const salt = generateSalt();
    const saltBase64 = btoa(String.fromCharCode(...salt));
    const hash = await hashPasswordWithPBKDF2(password, salt);

    // VULN-019 fix: persist the iteration count used for this hash so
    // verifyPasswordWithPBKDF2 can verify with a single pass (constant time).
    await chrome.storage.local.set({
        [StorageKeys.MASTER_PASSWORD_ENABLED]: true,
        [StorageKeys.MASTER_PASSWORD_SALT]: saltBase64,
        [StorageKeys.MASTER_PASSWORD_HASH]: hash,
        [StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS]: ENVELOPE_ITERATIONS,
        [StorageKeys.IS_LOCKED]: true // 初期状態でロック（アンロック必要）
    });

    // 【セキュリティ修正】設定時はパスワードキャッシュをクリア（ロック状態で開始）
    cachedMasterPassword = null;
    isMasterPasswordRequired = true;

    // キャッシュをクリア
    cachedEncryptionKey = null;

    await logInfo(
        'Master password set',
        { strength: strength.score, level: strength.level },
        'storage/encryptionSession.ts'
    );

    return true;
}

/**
 * マスターパスワードを検証し、セッションをアンロックする
 * @param {string} password - マスターパスワード
 * @returns {Promise<boolean>} 成功した場合true
 */
export async function unlockWithPassword(password: string): Promise<boolean> {
    // VULN-018 fix: check rate limit before attempting password verification
    const rateLimitResult = await checkRateLimit();
    if (!rateLimitResult.success) {
        throw new Error(rateLimitResult.error || 'Too many attempts. Please try again later.');
    }

    const result = await chrome.storage.local.get([
        StorageKeys.MASTER_PASSWORD_HASH,
        StorageKeys.MASTER_PASSWORD_SALT,
        StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS,
        StorageKeys.MASTER_PASSWORD_ENABLED
    ]);

    const enabled = result[StorageKeys.MASTER_PASSWORD_ENABLED] as boolean;
    if (!enabled) {
        throw new Error('Master password not enabled');
    }

    const storedHash = result[StorageKeys.MASTER_PASSWORD_HASH] as string;
    const saltBase64 = result[StorageKeys.MASTER_PASSWORD_SALT] as string;
    const storedIterations = result[StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS] as number | undefined;

    if (!storedHash || !saltBase64) {
        throw new Error('Master password data corrupted');
    }

    const salt = base64ToUint8Array(saltBase64);
    // Pass stored iterations to enable constant-time verification:
    // when iterations is known, only one PBKDF2 pass is needed.
    const verifyResult = await verifyPasswordWithPBKDF2(password, storedHash, salt, storedIterations);

    if (verifyResult.isValid) {
        // VULN-019 fix: re-hash with new iteration count if legacy hash was used
        if (verifyResult.needsRehash) {
            const newHash = await hashPasswordWithPBKDF2(password, salt);
            await chrome.storage.local.set({
                [StorageKeys.MASTER_PASSWORD_HASH]: newHash,
                [StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS]: ENVELOPE_ITERATIONS,
            });
            logInfo('Migrated master password hash to stronger KDF (600,000 iterations)');
        }
        // VULN-018 fix: reset failed attempts on successful authentication
        await resetFailedAttempts();
        // アクティビティ通知を送信（sessionAlarmsManager.tsへ）
        chrome.runtime.sendMessage({ type: 'ACTIVITY_UPDATE', protocolVersion: CURRENT_PROTOCOL_VERSION, payload: {} }).catch((error) => {
            // 送信失敗は無視（Service Workerが起動していない可能性）
            logDebug('Failed to send activity update', { error: error.message }, 'storage/encryptionSession.ts');
        });
        cachedMasterPassword = password;
        cachedEncryptionKey = null; // 新しいキーを生成するためにキャッシュをクリア
        await chrome.storage.local.set({ [StorageKeys.IS_LOCKED]: false });
        return true;
    }

    // VULN-018 fix: record failed attempt
    await recordFailedAttempt();
    return false;
}

/**
 * セッションをロックする（マスターパスワードキャッシュをクリア）
 */
export async function lockSession(): Promise<void> {
    cachedMasterPassword = null;
    cachedEncryptionKey = null;
    await chrome.storage.local.set({ [StorageKeys.IS_LOCKED]: true });
}

/**
 * マスターパスワードを再設定する（古いパスワード検証後）
 * @param {string} oldPassword - 現在のマスターパスワード
 * @param {string} newPassword - 新しいマスターパスワード
 * @returns {Promise<boolean>} 成功した場合true
 */
export async function changeMasterPassword(oldPassword: string, newPassword: string): Promise<boolean> {
    // まず古いパスワードでアンロック試行
    const isValid = await unlockWithPassword(oldPassword);
    if (!isValid) {
        return false;
    }

    // 新しいパスワードを設定（ロック状態になる）
    await setMasterPassword(newPassword);

    // 新しいパスワードでアンロックしてセッションを維持
    return unlockWithPassword(newPassword);
}

/**
 * マスターパスワード設定を解除する（すべての暗号化データを再暗号化できないため注意が必要）
 */
export async function removeMasterPassword(): Promise<void> {
    await chrome.storage.local.remove([
        StorageKeys.MASTER_PASSWORD_ENABLED,
        StorageKeys.MASTER_PASSWORD_SALT,
        StorageKeys.MASTER_PASSWORD_HASH,
        StorageKeys.IS_LOCKED
    ]);

    cachedMasterPassword = null;
    isMasterPasswordRequired = false;
    cachedEncryptionKey = null;
}

/**
 * 暗号化キーのキャッシュをクリアする（テスト用）
 */
export function clearEncryptionKeyCache(): void {
    cachedEncryptionKey = null;
    cachedMasterPassword = null;
    cachedHmacSecret = null;
}

/**
 * HMAC Secretを取得または作成する。
 * chrome.storage.local には AES-GCM でラップした envelope 形式でのみ保存し、
 * 平文base64は保存しない（設定インポート署名鍵の漏洩耐性のため）。
 * 旧形式（平文base64）が見つかった場合は透過的にラップ形式へ移行する。
 * @returns {Promise<string>} HMACシークレット（呼び出し元には従来通り平文文字列を返す）
 */
export async function getOrCreateHmacSecret(): Promise<string> {
    if (cachedHmacSecret) {
        return cachedHmacSecret;
    }

    const result = await chrome.storage.local.get(StorageKeys.HMAC_SECRET);
    const stored = result[StorageKeys.HMAC_SECRET];

    let secret: string;

    if (isWrappedSecretString(stored)) {
        try {
            secret = await unwrapSecretString(stored);
        } catch (e) {
            // The KEK lives in chrome.storage.session and is cleared on browser/
            // extension restart, so unwrapping an already-wrapped secret can fail
            // for existing users. Self-heal instead of throwing: generate a fresh
            // secret and persist it wrapped (mirrors hmacKeyStore recovery).
            const { logError, ErrorCode } = await import('../logger.js');
            const { errorMessage } = await import('../errorUtils.js');
            await logError('Failed to unwrap HMAC secret, regenerating', { error: errorMessage(e as Error) }, ErrorCode.CRYPTO_ENCRYPTION_FAILURE);
            const secretBytes = crypto.getRandomValues(new Uint8Array(32));
            secret = btoa(String.fromCharCode(...secretBytes));
            const wrapped = await wrapSecretString(secret);
            await chrome.storage.local.set({ [StorageKeys.HMAC_SECRET]: wrapped });
        }
    } else if (typeof stored === 'string' && stored.length > 0) {
        // Legacy plaintext secret: migrate to wrapped form.
        secret = stored;
        const wrapped = await wrapSecretString(secret);
        await chrome.storage.local.set({ [StorageKeys.HMAC_SECRET]: wrapped });
    } else {
        // 32バイトのランダムシークレットを生成
        const secretBytes = crypto.getRandomValues(new Uint8Array(32));
        secret = btoa(String.fromCharCode(...secretBytes));

        const wrapped = await wrapSecretString(secret);
        await chrome.storage.local.set({ [StorageKeys.HMAC_SECRET]: wrapped });
    }

    cachedHmacSecret = secret;
    return secret;
}
