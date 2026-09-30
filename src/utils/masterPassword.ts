/**
 * masterPassword.ts
 * Master password verification, strength check, and validation helpers.
 * Setting and changing passwords live in utils/storage/encryptionSession.js,
 * the single canonical implementation.
 */

import { errorMessage } from './errorUtils.js';
import {
    hashPasswordWithPBKDF2,
    verifyPasswordWithPBKDF2,
    base64ToBytes,
} from './crypto/index.js';
import { validatePasswordPolicy } from './crypto/cryptoParams.js';

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
 * パスワード最小要件をバリデート — SSOT 委譲
 * @param {string} password - パスワード
 * @returns {string | null} エラーメッセージ（成功ならnull）
 */
export function validatePasswordRequirements(password: string): string | null {
    const result = validatePasswordPolicy(password);
    return result.ok ? null : (result.reason ?? 'Invalid password');
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
        const salt = base64ToBytes(saltBase64);

        // パスワード検証（VULN-019: returns {isValid, needsRehash}）
        const verifyResult = await verifyPasswordWithPBKDF2(password, hash, salt);

        if (!verifyResult.isValid) {
            return { success: false, error: 'Incorrect password' };
        }

        // VULN-019 fix: re-hash with new iteration count if legacy hash was used
        if (verifyResult.needsRehash) {
            const newHash = await hashPasswordWithPBKDF2(password, salt);
            await chrome.storage.local.set({ master_password_hash: newHash });
        }

        return { success: true };
    } catch (e: unknown) {
        return { success: false, error: errorMessage(e) };
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