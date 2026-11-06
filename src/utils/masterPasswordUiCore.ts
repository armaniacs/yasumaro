/**
 * masterPasswordUiCore.ts
 * マスターパスワードUIの共有ビジネスロジック
 * popup/dashboard間で重複していたロジックをここに集約する
 */

import { validatePasswordRequirements, validatePasswordMatch } from './masterPassword.js';
import { getMessageOr } from './i18n.js';

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
        // NOTE: show the SSOT reason verbatim. The legacy `passwordTooShort`
        // locale key ("8文字以上...") predates the unified policy (12+ chars,
        // 3 of 4 classes, score>=40) and hid the real cause, so it must not
        // be used here.
        errorEl.textContent = requirementError;
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
        errorEl.textContent = getMessageOr('passwordMismatch', matchError);
        errorEl.classList.add('visible');
        return true;
    }
    return false;
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
        strengthText.textContent = getMessageOr('passwordStrengthWeak', 'Weak');
        return;
    }

    const result = calculatePasswordStrength(password);
    strengthBar.style.width = `${result.score}%`;
    strengthBar.className = `strength-fill ${result.level}`;
    strengthText.textContent = getMessageOr(`passwordStrength${result.level.charAt(0).toUpperCase() + result.level.slice(1)}`, result.text);
}
