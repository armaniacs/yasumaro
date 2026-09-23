/**
 * fieldValidation.ts
 * フィールドバリデーションモジュール
 * 設定フォームの各入力フィールドのバリデーションを行う
 */

import { getMessage } from '../../utils/i18n.js';
import {
    GENERAL_SETTINGS_FIELDS,
    validateGeminiApiVersionValue,
    validateMaxTokensValue,
    validateMinScrollDepthValue,
    validateMinVisitDurationValue,
    validateObsidianHostValue,
    validatePortValue,
    validateProtocolValue,
    type FieldDescriptor,
    type ValidationContext,
} from './fieldDescriptor.js';

export type ErrorPair = [HTMLInputElement | null, string];

/**
 * フィールドバリデーションの結果を表示
 * @param {HTMLInputElement} input - 入力要素
 * @param {string} errorId - エラーメッセージ表示要素のID
 * @param {string} message - エラーメッセージ
 */
export function setFieldError(input: HTMLInputElement, errorId: string, message: string): void {
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
export function clearFieldError(input: HTMLInputElement, errorId: string): void {
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
export function clearAllFieldErrors(pairs: ErrorPair[]): void {
    for (const [input, errorId] of pairs) {
        if (input) clearFieldError(input, errorId);
    }
}

/**
 * プロトコルの警告を表示（HTTP選択時のセキュリティ注意喚起）
 * @param {string} message - 警告メッセージ
 */
function showProtocolWarning(message: string): void {
    const warningEl = document.getElementById('protocolWarning');
    if (warningEl) {
        warningEl.textContent = message;
        warningEl.classList.remove('hidden');
    }
}

/**
 * プロトコルの警告をクリア
 */
function clearProtocolWarning(): void {
    const warningEl = document.getElementById('protocolWarning');
    if (warningEl) {
        warningEl.textContent = '';
        warningEl.classList.add('hidden');
    }
}

/**
 * プロトコルフィールドのバリデーション
 * @param {HTMLInputElement} input - 入力要素
 * @returns {boolean} 有効な場合はtrue
 */
export function validateProtocol(input: HTMLInputElement): boolean {
    const v = input.value.trim().toLowerCase();

    // エラークリア（警告は個別に制御）
    clearFieldError(input, 'protocolError');
    clearProtocolWarning();

    if (v === 'http') {
        // HTTPは有効だが、セキュリティ上の注意を促す
        showProtocolWarning(getMessage('warningProtocolHttp'));
    }
    // Decision delegates to the descriptor table (obsidianConfigValidator SSOT)
    if (validateProtocolValue(input.value) !== null) {
        setFieldError(input, 'protocolError', getMessage('errorProtocol'));
        return false;
    }
    return true;
}

/**
 * ポート番号フィールドのバリデーション
 * @param {HTMLInputElement} input - 入力要素
 * @returns {boolean} 有効な場合はtrue
 */
export function validatePort(input: HTMLInputElement): boolean {
    // Single ownership: decision delegates to the descriptor table, which in
    // turn defers to validateObsidianPort so UI and connection test agree.
    if (validatePortValue(input.value) !== null) {
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
export function validateMinVisitDuration(input: HTMLInputElement): boolean {
    // Decision delegates to the descriptor table (single owner of the floor).
    if (validateMinVisitDurationValue(parseInt(input.value, 10)) !== null) {
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
export function validateMinScrollDepth(input: HTMLInputElement): boolean {
    // Decision delegates to the descriptor table (single owner of 0-100).
    if (validateMinScrollDepthValue(parseInt(input.value, 10)) !== null) {
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
export async function validateBaseUrl(input: HTMLInputElement): Promise<boolean> {
    const v = input.value.trim();
    if (!v) {
        // 空文字は許容（デフォルト値が使用される）
        clearFieldError(input, 'baseUrlError');
        return true;
    }

    try {
        new URL(v);

        // ホワイトリストチェック
        const { isDomainInWhitelist, ALLOWED_AI_PROVIDER_DOMAINS } = await import('../../utils/storage/urlWhitelist.js');
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
    } catch (_e) {
        setFieldError(input, 'baseUrlError', getMessage('errorInvalidUrl') || 'Invalid URL format');
        return false;
    }
}

/**
 * プロトコルフィールドのバリデーションイベントリスナーを設定
 * @param {HTMLInputElement} input - 入力要素
 * @returns {() => void} リスナー削除関数
 */
export function setupProtocolValidation(input: HTMLInputElement | null): () => void {
    if (!input) return () => {};
    const handler = () => validateProtocol(input);
    input.addEventListener('blur', handler);
    return () => input.removeEventListener('blur', handler);
}

/**
 * ポート番号フィールドのバリデーションイベントリスナーを設定
 * @param {HTMLInputElement} input - 入力要素
 * @returns {() => void} リスナー削除関数
 */
export function setupPortValidation(input: HTMLInputElement | null): () => void {
    if (!input) return () => {};
    const handler = () => validatePort(input);
    input.addEventListener('blur', handler);
    return () => input.removeEventListener('blur', handler);
}

/**
 * 最小訪問時間フィールドのバリデーションイベントリスナーを設定
 * @param {HTMLInputElement} input - 入力要素
 * @returns {() => void} リスナー削除関数
 */
export function setupMinVisitDurationValidation(input: HTMLInputElement | null): () => void {
    if (!input) return () => {};
    const handler = () => validateMinVisitDuration(input);
    input.addEventListener('blur', handler);
    return () => input.removeEventListener('blur', handler);
}

/**
 * 最小スクロール深度フィールドのバリデーションイベントリスナーを設定
 * @param {HTMLInputElement} input - 入力要素
 * @returns {() => void} リスナー削除関数
 */
export function setupMinScrollDepthValidation(input: HTMLInputElement | null): () => void {
    if (!input) return () => {};
    const handler = () => validateMinScrollDepth(input);
    input.addEventListener('blur', handler);
    return () => input.removeEventListener('blur', handler);
}

/**
 * 最大トークン数フィールドのバリデーション
 * @param {HTMLInputElement} input - 入力要素
 * @returns {boolean} 有効な場合はtrue
 */
export function validateMaxTokens(input: HTMLInputElement, providerId = ''): boolean {
    // Decision delegates to aiLimits.validateMaxTokens via the descriptor
    // table — the clamp is the single decision, so provider-specific caps
    // (e.g. gemini 8192) apply without a UI-side range literal.
    if (validateMaxTokensValue(parseInt(input.value, 10), providerId) !== null) {
        setFieldError(input, 'maxTokensError', getMessage('error_max_tokens_range'));
        return false;
    }
    clearFieldError(input, 'maxTokensError');
    return true;
}

/**
 * 最大トークン数フィールドのバリデーションイベントリスナーを設定
 * @param {HTMLInputElement} input - 入力要素
 * @returns {() => void} リスナー削除関数
 */
export function setupMaxTokensValidation(input: HTMLInputElement | null, providerId = ''): () => void {
    if (!input) return () => {};
    const handler = () => validateMaxTokens(input, providerId);
    input.addEventListener('blur', handler);
    return () => input.removeEventListener('blur', handler);
}

/**
 * Obsidian ホストフィールドのバリデーション
 * @param {HTMLInputElement} input - 入力要素
 * @returns {boolean} 有効な場合はtrue
 */
export function validateObsidianHost(input: HTMLInputElement): boolean {
    // Single ownership: decision delegates to the descriptor table, which in
    // turn defers to the SW-side validator so UI and connection test agree.
    if (validateObsidianHostValue(input.value) !== null) {
        setFieldError(input, 'obsidianHostError', getMessage('obsidianHostError') || 'Obsidian host contains invalid characters.');
        return false;
    }
    clearFieldError(input, 'obsidianHostError');
    return true;
}

/**
 * Gemini API バージョンフィールドのバリデーション
 * @param {HTMLInputElement} input - 入力要素
 * @returns {boolean} 有効な場合はtrue
 */
export function validateGeminiApiVersion(input: HTMLInputElement): boolean {
    // Decision delegates to the descriptor table (single owner of the shape).
    if (validateGeminiApiVersionValue(input.value) !== null) {
        setFieldError(input, 'geminiApiVersionError', getMessage('geminiApiVersionError') || 'Gemini API version must be like v1 or v1beta.');
        return false;
    }
    clearFieldError(input, 'geminiApiVersionError');
    return true;
}

/**
 * Obsidian ホストフィールドのバリデーションイベントリスナーを設定
 * @param {HTMLInputElement} input - 入力要素
 * @returns {() => void} リスナー削除関数
 */
export function setupObsidianHostValidation(input: HTMLInputElement | null): () => void {
    if (!input) return () => {};
    const handler = () => validateObsidianHost(input);
    input.addEventListener('blur', handler);
    return () => input.removeEventListener('blur', handler);
}

/**
 * Gemini API バージョンフィールドのバリデーションイベントリスナーを設定
 * @param {HTMLInputElement} input - 入力要素
 * @returns {() => void} リスナー削除関数
 */
export function setupGeminiApiVersionValidation(input: HTMLInputElement | null): () => void {
    if (!input) return () => {};
    const handler = () => validateGeminiApiVersion(input);
    input.addEventListener('blur', handler);
    return () => input.removeEventListener('blur', handler);
}

/**
 * Generic descriptor-driven single-field validation: parse the raw input,
 * run the table's SSOT validator, and show/clear the table's error element.
 * New table rows get blur-validation via setupDescriptorValidation with no
 * edits here. (Protocol's HTTP warning side-channel stays in
 * validateProtocol; use the dedicated validator where that warning matters.)
 */
export function validateDescriptorField(
    descriptor: FieldDescriptor<unknown>,
    input: HTMLInputElement,
    ctx?: ValidationContext
): boolean {
    const errorKey = descriptor.validate(descriptor.parse(input.value), ctx);
    if (errorKey !== null) {
        setFieldError(input, descriptor.errorId, getMessage(errorKey) || errorKey);
        return false;
    }
    clearFieldError(input, descriptor.errorId);
    return true;
}

/**
 * Generic descriptor-driven blur listener setup.
 */
export function setupDescriptorValidation(
    descriptor: FieldDescriptor<unknown>,
    input: HTMLInputElement | null,
    ctx?: ValidationContext
): () => void {
    if (!input) return () => {};
    const handler = () => validateDescriptorField(descriptor, input, ctx);
    input.addEventListener('blur', handler);
    return () => input.removeEventListener('blur', handler);
}

/**
 * Validate every descriptor-table field by resolving inputs from the DOM.
 * New table rows are picked up automatically.
 */
export function validateAllDescriptorFields(ctx?: ValidationContext): boolean {
    let hasError = false;
    for (const descriptor of GENERAL_SETTINGS_FIELDS) {
        const input = document.getElementById(descriptor.elementId) as HTMLInputElement | null;
        if (input && !validateDescriptorField(descriptor, input, ctx)) hasError = true;
    }
    return !hasError;
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
    protocolInput: HTMLInputElement | null,
    portInput: HTMLInputElement | null,
    minVisitDurationInput?: HTMLInputElement | null,
    minScrollDepthInput?: HTMLInputElement | null,
    maxTokensPerPromptInput?: HTMLInputElement | null,
    providerId = ''
): (() => void)[] {
    const listeners: (() => void)[] = [
        setupProtocolValidation(protocolInput),
        setupPortValidation(portInput),
    ];
    if (minVisitDurationInput) listeners.push(setupMinVisitDurationValidation(minVisitDurationInput));
    if (minScrollDepthInput) listeners.push(setupMinScrollDepthValidation(minScrollDepthInput));
    if (maxTokensPerPromptInput) listeners.push(setupMaxTokensValidation(maxTokensPerPromptInput, providerId));
    return listeners;
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
    protocolInput: HTMLInputElement | null,
    portInput: HTMLInputElement | null,
    minVisitDurationInput?: HTMLInputElement | null,
    minScrollDepthInput?: HTMLInputElement | null,
    maxTokensPerPromptInput?: HTMLInputElement | null,
    providerId = ''
): boolean {
    let hasError = false;

    if (protocolInput && !validateProtocol(protocolInput)) hasError = true;
    if (portInput && !validatePort(portInput)) hasError = true;
    if (minVisitDurationInput && !validateMinVisitDuration(minVisitDurationInput)) hasError = true;
    if (minScrollDepthInput && !validateMinScrollDepth(minScrollDepthInput)) hasError = true;
    if (maxTokensPerPromptInput && !validateMaxTokens(maxTokensPerPromptInput, providerId)) hasError = true;

    return !hasError;
}