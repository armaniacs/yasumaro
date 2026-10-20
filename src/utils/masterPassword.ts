/**
 * masterPassword.ts
 * Master password strength check, validation, and flag helpers.
 * Verification, setting, and changing passwords live in
 * utils/storage/encryptionSession.js, the single canonical implementation.
 */

import { scorePassword, validatePasswordPolicy, type PasswordStrengthLevel } from './crypto/cryptoParams.js';

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

/** SSOT level ('Weak'/'Medium'/'Strong') to the PasswordStrength enum. */
const LEVEL_TO_STRENGTH: Readonly<Record<PasswordStrengthLevel, PasswordStrength>> = {
    Weak: PasswordStrength.WEAK,
    Medium: PasswordStrength.MEDIUM,
    Strong: PasswordStrength.STRONG
};

/**
 * Calculates password strength by delegating to the SSOT scorePassword
 * in cryptoParams.ts (single implementation of the scoring weights and
 * the 40/80 level thresholds).
 * @param {string} password - password to score
 * @returns {PasswordStrengthResult} password strength result
 */
export function calculatePasswordStrength(password: string): PasswordStrengthResult {
    const { score, level } = scorePassword(password);
    return { score, level: LEVEL_TO_STRENGTH[level], text: level };
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