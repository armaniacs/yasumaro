/**
 * masterPasswordUiCore.ts
 * マスターパスワードUIの共有ビジネスロジック
 * popup/dashboard間で重複していたロジックをここに集約する
 */

import { validatePasswordRequirements, validatePasswordMatch } from './masterPassword.js';
import { getMessage } from './i18n.js';

/**
 * パスワード要件バリデーションを実行し、エラー要素にメッセージを設定する
 * @returns エラーがある場合 true
 */
export function validateAndSetPasswordErrors(
    password: string,
    errorEl: HTMLElement | null
): boolean {
    const requirementError = validatePasswordRequirements(password);
    if (requirementError && errorEl) {
        errorEl.textContent = getMessage('passwordTooShort') || requirementError;
        errorEl.classList.add('visible');
        return true;
    }
    return false;
}

/**
 * パスワード一致バリデーションを実行し、エラー要素にメッセージを設定する
 * @returns エラーがある場合 true
 */
export function validateAndSetMatchErrors(
    password: string,
    confirmPassword: string,
    errorEl: HTMLElement | null
): boolean {
    const matchError = validatePasswordMatch(password, confirmPassword);
    if (matchError && errorEl) {
        errorEl.textContent = getMessage('passwordMismatch') || matchError;
        errorEl.classList.add('visible');
        return true;
    }
    return false;
}

/**
 * chrome.storage.local.set をラップする関数を生成
 */
export function buildSetStorageFn() {
    return async (key: string, value: unknown) => {
        await chrome.storage.local.set({ [key]: value });
    };
}

/**
 * chrome.storage.local.get をラップする関数を生成
 */
export function buildGetStorageFn() {
    return async (keys: string[]) => {
        return chrome.storage.local.get(keys);
    };
}

/**
 * パスワード強度インジケータを更新する
 */
export function updatePasswordStrengthDisplay(
    password: string,
    strengthBar: HTMLElement | null,
    strengthText: HTMLElement | null,
    calculatePasswordStrength: (pwd: string) => { score: number; level: string; text: string }
): void {
    if (!strengthBar || !strengthText) return;

    if (!password) {
        strengthBar.style.width = '0%';
        strengthBar.className = 'strength-fill';
        strengthText.textContent = getMessage('passwordStrengthWeak') || 'Weak';
        return;
    }

    const result = calculatePasswordStrength(password);
    strengthBar.style.width = `${result.score}%`;
    strengthBar.className = `strength-fill ${result.level}`;
    strengthText.textContent = getMessage(`passwordStrength${result.level.charAt(0).toUpperCase() + result.level.slice(1)}`) || result.text;
}
