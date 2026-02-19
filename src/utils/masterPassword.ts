/**
 * masterPassword.ts
 * マスターパスワード管理モジュール
 * パスワード設定、検証、変更、パスワード強度チェック
 */

import type { EncryptedData } from './typesCrypto.js';
import {
    generateSalt,
    hashPasswordWithPBKDF2,
    verifyPasswordWithPBKDF2,
    encrypt,
    decryptData
} from './crypto.js';
import type { StorageKeys } from './storage.js';

// パスワード強度レベル
export enum PasswordStrength {
    WEAK = 'weak',
    MEDIUM = 'medium',
    STRONG = 'strong'
}

export interface PasswordStrengthResult {
    score: number; // 0-100
    level: PasswordStrength;
    text: string;
}

/**
 * パスワード強度を計算
 * @param {string} password - パスワード
 * @returns {PasswordStrengthResult} パスワード強度結果
 */
export function calculatePasswordStrength(password: string): PasswordStrengthResult {
    let score = 0;

    // 長さチェック
    if (password.length >= 8) score += 20;
    if (password.length >= 12) score += 10;

    // 大文字小文字混在
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 20;

    // 数字を含む
    if (/\d/.test(password)) score += 20;

    // 特殊文字を含む
    if (/[^a-zA-Z0-9]/.test(password)) score += 30;

    // 最大値を100に制限
    score = Math.min(score, 100);

    // レベル判定
    let level: PasswordStrength;
    let text: string;

    if (score < 40) {
        level = PasswordStrength.WEAK;
        text = 'Weak';
    } else if (score < 80) {
        level = PasswordStrength.MEDIUM;
        text = 'Medium';
    } else {
        level = PasswordStrength.STRONG;
        text = 'Strong';
    }

    return { score, level, text };
}

/**
 * パスワード最小要件をバリデート
 * @param {string} password - パスワード
 * @returns {string | null} エラーメッセージ（成功ならnull）
 */
export function validatePasswordRequirements(password: string): string | null {
    if (!password) {
        return 'Password is required';
    }
    if (password.length < 8) {
        return 'Password must be at least 8 characters long';
    }
    return null;
}

/**
 * パスワード一致チェック
 * @param {string} password - パスワード
 * @param {string} confirmPassword - 確認用パスワード
 * @returns {string | null} エラーメッセージ（成功ならnull）
 */
export function validatePasswordMatch(password: string, confirmPassword: string): string | null {
    if (password !== confirmPassword) {
        return 'Passwords do not match';
    }
    return null;
}

/**
 * マスターパスワードを設定
 * @param {string} password - パスワード
 * @param {(key: string, value: unknown) => Promise<void>} setStorageFn - ストレージ保存関数
 * @returns {Promise<{success: boolean; error?: string}>} 結果
 */
export async function setMasterPassword(
    password: string,
    setStorageFn: (key: string, value: unknown) => Promise<void>
): Promise<{ success: boolean; error?: string }> {
    try {
        // パスワード要件チェック
        const error = validatePasswordRequirements(password);
        if (error) {
            return { success: false, error };
        }

        // ソルト生成
        const salt = generateSalt();

        // パスワードハッシュ生成
        const hash = await hashPasswordWithPBKDF2(password, salt);

        // ストレージに保存
        await setStorageFn('master_password_salt', btoa(String.fromCharCode(...salt)));
        await setStorageFn('master_password_hash', hash);
        await setStorageFn('master_password_enabled', true);

        return { success: true };
    } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * マスターパスワードを検証
 * @param {string} password - パスワード
 * @param {(keys: string[]) => Promise<Record<string, unknown>>} getStorageFn - ストレージ取得関数
 * @returns {Promise<{success: boolean; error?: string}>} 結果
 */
export async function verifyMasterPassword(
    password: string,
    getStorageFn: (keys: string[]) => Promise<Record<string, unknown>>
): Promise<{ success: boolean; error?: string }> {
    try {
        const result = await getStorageFn(['master_password_salt', 'master_password_hash']);
        const saltBase64 = result['master_password_salt'] as string | undefined;
        const hash = result['master_password_hash'] as string | undefined;

        if (!saltBase64 || !hash) {
            return { success: false, error: 'Master password not set' };
        }

        // Base64デコード
        const salt = new Uint8Array(atob(saltBase64).split('').map(c => c.charCodeAt(0)));

        // パスワード検証
        const isValid = await verifyPasswordWithPBKDF2(password, hash, salt);

        if (!isValid) {
            return { success: false, error: 'Incorrect password' };
        }

        return { success: true };
    } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * マスターパスワードを変更
 * @param {string} oldPassword - 古いパスワード
 * @param {string} newPassword - 新しいパスワード
 * @param {(keys: string[]) => Promise<Record<string, unknown>>} getStorageFn - ストレージ取得関数
 * @param {(key: string, value: unknown) => Promise<void>} setStorageFn - ストレージ保存関数
 * @param {encryptedData: EncryptedData | null, newKey: CryptoKey} reencryptFn - 再暗号化関数
 * @returns {Promise<{success: boolean; error?: string}>} 結果
 */
export async function changeMasterPassword(
    oldPassword: string,
    newPassword: string,
    getStorageFn: (keys: string[]) => Promise<Record<string, unknown>>,
    setStorageFn: (key: string, value: unknown) => Promise<void>,
    reencryptFn: (encryptedData: EncryptedData | null, newKey: CryptoKey) => Promise<void>
): Promise<{ success: boolean; error?: string }> {
    try {
        // 古いパスワード検証
        const verifyResult = await verifyMasterPassword(oldPassword, getStorageFn);
        if (!verifyResult.success) {
            return verifyResult;
        }

        // 新しいパスワード要件チェック
        const error = validatePasswordRequirements(newPassword);
        if (error) {
            return { success: false, error };
        }

        // 古いソルトを取得
        const result = await getStorageFn(['master_password_salt']);
        const oldSaltBase64 = result['master_password_salt'] as string | undefined;

        // 古いパスワードでキーを取得（再暗号化用）
        const { deriveKey } = await import('./crypto.js');
        const oldSalt = oldSaltBase64
            ? new Uint8Array(atob(oldSaltBase64).split('').map(c => c.charCodeAt(0)))
            : generateSalt();
        const oldKey = await deriveKey(oldPassword, oldSalt);

        // 新しいソルト、ハッシュ、キーを生成
        const newSalt = generateSalt();
        const newHash = await hashPasswordWithPBKDF2(newPassword, newSalt);
        const newKey = await deriveKey(newPassword, newSalt);

        // 暗号化されたAPIキーを再暗号化
        const encryptedDataList: Array<{ key: string; encryptedData: EncryptedData | null }> = [];
        const apiKeyFields = ['obsidian_api_key', 'gemini_api_key', 'openai_api_key', 'openai_2_api_key'];
        for (const field of apiKeyFields) {
            const settings = await getStorageFn([field]);
            const value = settings[field] as EncryptedData | string | undefined;

            if (value && typeof value === 'object' && value.ciphertext) {
                encryptedDataList.push({ key: field, encryptedData: value as EncryptedData });
            }
        }

        // 古いキーで復号して新しいキーで暗号化
        for (const { key, encryptedData } of encryptedDataList) {
            // 古いキーでパスワードを取得（再暗号化用）
            const { decryptData } = await import('./crypto.js');
            const plaintext = await decryptData(encryptedData!, oldKey);
            const reencrypted = await encrypt(plaintext, newKey);
            await setStorageFn(key, reencrypted);
        }

        // 新しいソルトとハッシュを保存
        await setStorageFn('master_password_salt', btoa(String.fromCharCode(...newSalt)));
        await setStorageFn('master_password_hash', newHash);
        await setStorageFn('master_password_enabled', true);

        return { success: true };
    } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * マスターパスワードが設定されているかチェック
 * @param {(keys: string[]) => Promise<Record<string, unknown>>} getStorageFn - ストレージ取得関数
 * @returns {Promise<boolean>} 設定されている場合はtrue
 */
export async function isMasterPasswordSet(
    getStorageFn: (keys: string[]) => Promise<Record<string, unknown>>
): Promise<boolean> {
    const result = await getStorageFn(['master_password_enabled']);
    return Boolean(result['master_password_enabled']);
}