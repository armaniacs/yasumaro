/**
 * フィールドバリデーションモジュール
 * 設定フォームの各入力フィールドのバリデーションを行う
 */

import { getMessage } from '../i18n.js';

/**
 * フィールドバリデーションの結果を表示
 * @param {HTMLInputElement} input - 入力要素
 * @param {string} errorId - エラーメッセージ表示要素のID
 * @param {string} message - エラーメッセージ
 */
export function setFieldError(input, errorId, message) {
    const errorEl = document.getElementById(errorId);
    input.setAttribute('aria-invalid', 'true');
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.classList.add('visible');
    }
}

/**
 * フィールドのエラー状態をクリア
 * @param {HTMLInputElement} input - 入力要素
 * @param {string} errorId - エラーメッセージ表示要素のID
 */
export function clearFieldError(input, errorId) {
    const errorEl = document.getElementById(errorId);
    input.setAttribute('aria-invalid', 'false');
    if (errorEl) {
        errorEl.textContent = '';
        errorEl.classList.remove('visible');
    }
}

/**
 * すべてのフィールドエラーをクリア
 * @param {Array.<[HTMLInputElement, string]>} pairs - [input, errorId]の配列
 */
export function clearAllFieldErrors(pairs) {
    for (const [input, errorId] of pairs) {
        clearFieldError(input, errorId);
    }
}

/**
 * プロトコルフィールドのバリデーション
 * @param {HTMLInputElement} input - 入力要素
 * @returns {boolean} 有効な場合はtrue
 */
export function validateProtocol(input) {
    const v = input.value.trim().toLowerCase();
    if (v !== 'http' && v !== 'https') {
        setFieldError(input, 'protocolError', getMessage('errorProtocol'));
        return false;
    }
    clearFieldError(input, 'protocolError');
    return true;
}

/**
 * ポート番号フィールドのバリデーション
 * @param {HTMLInputElement} input - 入力要素
 * @returns {boolean} 有効な場合はtrue
 */
export function validatePort(input) {
    const v = parseInt(input.value.trim(), 10);
    if (isNaN(v) || v < 1 || v > 65535) {
        setFieldError(input, 'portError', getMessage('errorPort'));
        return false;
    }
    clearFieldError(input, 'portError');
    return true;
}

/**
 * 最小訪問時間フィールドのバリデーション
 * @param {HTMLInputElement} input - 入力要素
 * @returns {boolean} 有効な場合はtrue
 */
export function validateMinVisitDuration(input) {
    const v = parseInt(input.value, 10);
    if (isNaN(v) || v < 0) {
        setFieldError(input, 'minVisitDurationError', getMessage('errorDuration'));
        return false;
    }
    clearFieldError(input, 'minVisitDurationError');
    return true;
}

/**
 * 最小スクロール深度フィールドのバリデーション
 * @param {HTMLInputElement} input - 入力要素
 * @returns {boolean} 有効な場合はtrue
 */
export function validateMinScrollDepth(input) {
    const v = parseInt(input.value, 10);
    if (isNaN(v) || v < 0 || v > 100) {
        setFieldError(input, 'minScrollDepthError', getMessage('errorScrollDepth'));
        return false;
    }
    clearFieldError(input, 'minScrollDepthError');
    return true;
}

/**
 * BaseUrlフィールドのバリデーション
 * @param {HTMLInputElement} input - 入力要素
 * @returns {Promise<boolean>} 有効な場合はtrue
 */
export async function validateBaseUrl(input) {
    const v = input.value.trim();
    if (!v) {
        // 空文字は許容（デフォルト値が使用される）
        clearFieldError(input, 'baseUrlError');
        return true;
    }

    try {
        new URL(v);

        // ホワイトリストチェック
        const { isDomainInWhitelist, ALLOWED_AI_PROVIDER_DOMAINS } = await import('../../utils/storage.js');
        if (!isDomainInWhitelist(v)) {
            // メジャープロバイダーとワイルドカードドメインを重点表示
            const majorProviders = [
                'api.openai.com', 'api.anthropic.com', 'api.groq.com',
                'openrouter.ai', 'mistral.ai', 'deepinfra.com'
            ];
            const sakuraDomains = ['api.ai.sakura.ad.jp'];

            const message = `このドメインは許可リストにありません。\n\n` +
                `主要プロバイダー: ${majorProviders.join(', ')}\n` +
                `Sakuraクラウド: ${sakuraDomains.join(', ')}\n` +
                `その他: LiteLLM対応プロバイダー（全${ALLOWED_AI_PROVIDER_DOMAINS.length}ドメイン）`;

            setFieldError(input, 'baseUrlError', message);
            return false;
        }

        clearFieldError(input, 'baseUrlError');
        return true;
    } catch (e) {
        setFieldError(input, 'baseUrlError', getMessage('errorInvalidUrl') || 'Invalid URL format');
        return false;
    }
}

/**
 * プロトコルフィールドのバリデーションイベントリスナーを設定
 * @param {HTMLInputElement} input - 入力要素
 * @returns {() => void} リスナー削除関数
 */
export function setupProtocolValidation(input) {
    const handler = () => validateProtocol(input);
    input.addEventListener('blur', handler);
    return () => input.removeEventListener('blur', handler);
}

/**
 * ポート番号フィールドのバリデーションイベントリスナーを設定
 * @param {HTMLInputElement} input - 入力要素
 * @returns {() => void} リスナー削除関数
 */
export function setupPortValidation(input) {
    const handler = () => validatePort(input);
    input.addEventListener('blur', handler);
    return () => input.removeEventListener('blur', handler);
}

/**
 * 最小訪問時間フィールドのバリデーションイベントリスナーを設定
 * @param {HTMLInputElement} input - 入力要素
 * @returns {() => void} リスナー削除関数
 */
export function setupMinVisitDurationValidation(input) {
    const handler = () => validateMinVisitDuration(input);
    input.addEventListener('blur', handler);
    return () => input.removeEventListener('blur', handler);
}

/**
 * 最小スクロール深度フィールドのバリデーションイベントリスナーを設定
 * @param {HTMLInputElement} input - 入力要素
 * @returns {() => void} リスナー削除関数
 */
export function setupMinScrollDepthValidation(input) {
    const handler = () => validateMinScrollDepth(input);
    input.addEventListener('blur', handler);
    return () => input.removeEventListener('blur', handler);
}

/**
 * 主要フィールドのバリデーションイベントリスナーを一括設定
 * @param {HTMLInputElement} protocolInput - プロトコル入力
 * @param {HTMLInputElement} portInput - ポート入力
 * @param {HTMLInputElement} minVisitDurationInput - 最小訪問時間入力
 * @param {HTMLInputElement} minScrollDepthInput - 最小スクロール深度入力
 * @returns {Array.<() => void>} リスナー削除関数の配列
 */
export function setupAllFieldValidations(
    protocolInput,
    portInput,
    minVisitDurationInput,
    minScrollDepthInput
) {
    return [
        setupProtocolValidation(protocolInput),
        setupPortValidation(portInput),
        setupMinVisitDurationValidation(minVisitDurationInput),
        setupMinScrollDepthValidation(minScrollDepthInput)
    ];
}

/**
 * すべてのフィールドバリデーションを実行
 * @param {HTMLInputElement} protocolInput - プロトコル入力
 * @param {HTMLInputElement} portInput - ポート入力
 * @param {HTMLInputElement} minVisitDurationInput - 最小訪問時間入力
 * @param {HTMLInputElement} minScrollDepthInput - 最小スクロール深度入力
 * @returns {boolean} すべて有効な場合はtrue
 */
export function validateAllFields(
    protocolInput,
    portInput,
    minVisitDurationInput,
    minScrollDepthInput
) {
    let hasError = false;

    if (!validateProtocol(protocolInput)) hasError = true;
    if (!validatePort(portInput)) hasError = true;
    if (!validateMinVisitDuration(minVisitDurationInput)) hasError = true;
    if (!validateMinScrollDepth(minScrollDepthInput)) hasError = true;

    return !hasError;
}