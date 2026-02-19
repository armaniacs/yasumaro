/**
 * masterPassword.ts
 * マスターパスワード管理モジュール
 * パスワード設定、検証、変更、パスワード強度チェック
 */
import type { EncryptedData } from './typesCrypto.js';
export declare enum PasswordStrength {
    WEAK = "weak",
    MEDIUM = "medium",
    STRONG = "strong"
}
export interface PasswordStrengthResult {
    score: number;
    level: PasswordStrength;
    text: string;
}
/**
 * パスワード強度を計算
 * @param {string} password - パスワード
 * @returns {PasswordStrengthResult} パスワード強度結果
 */
export declare function calculatePasswordStrength(password: string): PasswordStrengthResult;
/**
 * パスワード最小要件をバリデート
 * @param {string} password - パスワード
 * @returns {string | null} エラーメッセージ（成功ならnull）
 */
export declare function validatePasswordRequirements(password: string): string | null;
/**
 * パスワード一致チェック
 * @param {string} password - パスワード
 * @param {string} confirmPassword - 確認用パスワード
 * @returns {string | null} エラーメッセージ（成功ならnull）
 */
export declare function validatePasswordMatch(password: string, confirmPassword: string): string | null;
/**
 * マスターパスワードを設定
 * @param {string} password - パスワード
 * @param {(key: string, value: unknown) => Promise<void>} setStorageFn - ストレージ保存関数
 * @returns {Promise<{success: boolean; error?: string}>} 結果
 */
export declare function setMasterPassword(password: string, setStorageFn: (key: string, value: unknown) => Promise<void>): Promise<{
    success: boolean;
    error?: string;
}>;
/**
 * マスターパスワードを検証
 * @param {string} password - パスワード
 * @param {(keys: string[]) => Promise<Record<string, unknown>>} getStorageFn - ストレージ取得関数
 * @returns {Promise<{success: boolean; error?: string}>} 結果
 */
export declare function verifyMasterPassword(password: string, getStorageFn: (keys: string[]) => Promise<Record<string, unknown>>): Promise<{
    success: boolean;
    error?: string;
}>;
/**
 * マスターパスワードを変更
 * @param {string} oldPassword - 古いパスワード
 * @param {string} newPassword - 新しいパスワード
 * @param {(keys: string[]) => Promise<Record<string, unknown>>} getStorageFn - ストレージ取得関数
 * @param {(key: string, value: unknown) => Promise<void>} setStorageFn - ストレージ保存関数
 * @param {encryptedData: EncryptedData | null, newKey: CryptoKey} reencryptFn - 再暗号化関数
 * @returns {Promise<{success: boolean; error?: string}>} 結果
 */
export declare function changeMasterPassword(oldPassword: string, newPassword: string, getStorageFn: (keys: string[]) => Promise<Record<string, unknown>>, setStorageFn: (key: string, value: unknown) => Promise<void>, reencryptFn: (encryptedData: EncryptedData | null, newKey: CryptoKey) => Promise<void>): Promise<{
    success: boolean;
    error?: string;
}>;
/**
 * マスターパスワードが設定されているかチェック
 * @param {(keys: string[]) => Promise<Record<string, unknown>>} getStorageFn - ストレージ取得関数
 * @returns {Promise<boolean>} 設定されている場合はtrue
 */
export declare function isMasterPasswordSet(getStorageFn: (keys: string[]) => Promise<Record<string, unknown>>): Promise<boolean>;
//# sourceMappingURL=masterPassword.d.ts.map