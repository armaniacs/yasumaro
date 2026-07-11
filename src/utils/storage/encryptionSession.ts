/**
 * storage/encryptionSession.ts
 * Master password lifecycle, encryption key derivation, and HMAC secret
 * management. Split out of storage.ts (PBI: storage.ts deepening).
 */

import { logInfo, logDebug } from '../logger.js';
import { calculatePasswordStrength } from '../masterPassword.js';
import {
    generateSalt,
    deriveKey,
    hashPasswordWithPBKDF2,
    verifyPasswordWithPBKDF2
} from '../crypto.js';
import { StorageKeys } from './types.js';

// ============================================================================
// Module-private session state
// ============================================================================

let cachedEncryptionKey: CryptoKey | null = null;
let cachedMasterPassword: string | null = null; // セッション中のマスターパスワードキャッシュ
let isMasterPasswordRequired = false; // マスターパスワードが設定済みかどうか
let cachedHmacSecret: string | null = null;

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
 */
async function deriveKeyFromPassword(password: string, salt: Uint8Array): Promise<CryptoKey> {
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
            iterations: 100000,
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
    if (cachedEncryptionKey) {
        return cachedEncryptionKey;
    }

    // マスターパスワード設定状態を確認
    const result = await chrome.storage.local.get([
        StorageKeys.MASTER_PASSWORD_ENABLED,
        StorageKeys.ENCRYPTION_SALT,
        StorageKeys.ENCRYPTION_SECRET,
        StorageKeys.MASTER_PASSWORD_SALT,
        StorageKeys.IS_LOCKED
    ]);

    const masterPasswordEnabled = result[StorageKeys.MASTER_PASSWORD_ENABLED] as boolean;

    if (masterPasswordEnabled) {
        // 【セキュリティ修正】マスターパスワードが設定されている場合は強制的にロック
        isMasterPasswordRequired = true;

        if (!cachedMasterPassword) {
            throw new Error('ENCRYPTION_LOCKED: Master password required');
        }

        // マスターパスワードからキーを導出
        const passwordSaltBase64 = result[StorageKeys.MASTER_PASSWORD_SALT] as string;
        if (!passwordSaltBase64) {
            throw new Error('CORRUPTION: Master password salt missing');
        }

        const passwordSalt = base64ToUint8Array(passwordSaltBase64);
        // PBKDF2キー導出を直接使用（マスターパスワードベース）
        cachedEncryptionKey = await deriveKeyFromPassword(cachedMasterPassword, passwordSalt);
        // セッションタイムアウトチェックを開始（まだ開始していない場合）
        // Note: Session timeoutはchrome.alarms APIに移行済み（sessionAlarmsManager.ts）
        return cachedEncryptionKey;
    }

    // マスターパスワード未設定の場合：従来の方式を使用（マイグレーション準備）
    // 注意：この方式は脆弱だが、マイグレーション完了まで維持
    let saltBase64 = result[StorageKeys.ENCRYPTION_SALT] as string;
    let secret = result[StorageKeys.ENCRYPTION_SECRET] as string;

    if (!saltBase64 || !secret) {
        // 初回: ソルトとシークレットを生成
        const salt = generateSalt();
        saltBase64 = btoa(String.fromCharCode(...salt));
        // 32バイトのランダムシークレットを生成
        const secretBytes = crypto.getRandomValues(new Uint8Array(32));
        secret = btoa(String.fromCharCode(...secretBytes));

        await chrome.storage.local.set({
            [StorageKeys.ENCRYPTION_SALT]: saltBase64,
            [StorageKeys.ENCRYPTION_SECRET]: secret
        });
    }

    const salt = base64ToUint8Array(saltBase64);

    // ランダムなsecretとsaltからPBKDF2でキー導出
    // 【セキュリティ】secretは初回生成時にcrypto.getRandomValuesで生成した32バイトの乱数であり、
    // これ単体で十分なエントロピーを持つ。以前はchrome.runtime.id（Extension ID）を
    // 追加で結合していたが、Extension IDは公開情報であるためセキュリティ上の
    // 価値がなく、誤った安心感を与えるだけだったため削除した。
    cachedEncryptionKey = await deriveKey(secret, salt);
    return cachedEncryptionKey;
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

    await chrome.storage.local.set({
        [StorageKeys.MASTER_PASSWORD_ENABLED]: true,
        [StorageKeys.MASTER_PASSWORD_SALT]: saltBase64,
        [StorageKeys.MASTER_PASSWORD_HASH]: hash,
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
    const result = await chrome.storage.local.get([
        StorageKeys.MASTER_PASSWORD_HASH,
        StorageKeys.MASTER_PASSWORD_SALT,
        StorageKeys.MASTER_PASSWORD_ENABLED
    ]);

    const enabled = result[StorageKeys.MASTER_PASSWORD_ENABLED] as boolean;
    if (!enabled) {
        throw new Error('Master password not enabled');
    }

    const storedHash = result[StorageKeys.MASTER_PASSWORD_HASH] as string;
    const saltBase64 = result[StorageKeys.MASTER_PASSWORD_SALT] as string;

    if (!storedHash || !saltBase64) {
        throw new Error('Master password data corrupted');
    }

    const salt = base64ToUint8Array(saltBase64);
    const isValid = await verifyPasswordWithPBKDF2(password, storedHash, salt);

    if (isValid) {
        // アクティビティ通知を送信（sessionAlarmsManager.tsへ）
        chrome.runtime.sendMessage({ type: 'ACTIVITY_UPDATE', payload: {} }).catch((error) => {
            // 送信失敗は無視（Service Workerが起動していない可能性）
            logDebug('Failed to send activity update', { error: error.message }, 'storage/encryptionSession.ts');
        });
        cachedMasterPassword = password;
        cachedEncryptionKey = null; // 新しいキーを生成するためにキャッシュをクリア
        await chrome.storage.local.set({ [StorageKeys.IS_LOCKED]: false });
        return true;
    }

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
}

/**
 * HMAC Secretを取得または作成する
 * @returns {Promise<string>} HMACシークレット
 */
export async function getOrCreateHmacSecret(): Promise<string> {
    if (cachedHmacSecret) {
        return cachedHmacSecret;
    }

    const result = await chrome.storage.local.get(StorageKeys.HMAC_SECRET);
    let secret = result[StorageKeys.HMAC_SECRET] as string;

    if (!secret) {
        // 32バイトのランダムシークレットを生成
        const secretBytes = crypto.getRandomValues(new Uint8Array(32));
        secret = btoa(String.fromCharCode(...secretBytes));

        await chrome.storage.local.set({
            [StorageKeys.HMAC_SECRET]: secret
        });
    }

    cachedHmacSecret = secret;
    return secret;
}
