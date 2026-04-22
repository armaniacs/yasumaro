/**
 * errorMessages.ts
 * エラーメッセージの管理と分離
 * 
 * 【目的】:
 * ユーザー向けエラーメッセージとログ用エラーメッセージを分離し、
 * 技術情報の漏洩を防ぐ
 * 
 * 【Code Review P2】: エラーメッセージの技術情報漏洩対策
 */

/**
 * エラータイプの定義
 */
export const ErrorType = {
    NETWORK: 'NETWORK',
    AUTH: 'AUTH',
    VALIDATION: 'VALIDATION',
    NOT_FOUND: 'NOT_FOUND',
    RATE_LIMIT: 'RATE_LIMIT',
    SERVER: 'SERVER',
    UNKNOWN: 'UNKNOWN'
} as const;

export type ErrorTypeValues = typeof ErrorType[keyof typeof ErrorType];

/**
 * ユーザー向けエラーメッセージのマッピング
 * 技術的な詳細を含まない、ユーザーフレンドリーなメッセージ
 */
const getUserMessageForType = (errorType: ErrorTypeValues): string => {
    switch (errorType) {
        case ErrorType.NETWORK:
            return chrome.i18n.getMessage('errorNetwork') || 'A network error occurred.';
        case ErrorType.AUTH:
            return chrome.i18n.getMessage('errorAuth') || 'An authentication error occurred.';
        case ErrorType.VALIDATION:
            return chrome.i18n.getMessage('errorValidation') || 'Invalid input.';
        case ErrorType.NOT_FOUND:
            return chrome.i18n.getMessage('errorNotFound') || 'Resource not found.';
        case ErrorType.RATE_LIMIT:
            return chrome.i18n.getMessage('errorRateLimit') || 'Request limit reached.';
        case ErrorType.SERVER:
            return chrome.i18n.getMessage('errorServer') || 'A server error occurred.';
        case ErrorType.UNKNOWN:
        default:
            return chrome.i18n.getMessage('errorGeneric') || 'An error occurred.';
    }
};

/**
 * Type guard for error-like objects (duck-typing for external data)
 * @param value - value to check
 * @returns true if the value looks like an Error object
 */
function isErrorLike(value: unknown): value is { message?: unknown; name?: unknown } {
    return typeof value === 'object' && value !== null && ('message' in value || 'name' in value);
}

/**
 * エラーを分類する
 * @param {Error} error - 発生したエラー
 * @returns {ErrorTypeValues} エラータイプ
 */
export function classifyError(error: unknown): ErrorTypeValues {
    if (!error) return ErrorType.UNKNOWN;

    const err = error instanceof Error ? error : null;
    const errorLike = !err && isErrorLike(error) ? error : null;
    const message = (err?.message ?? (errorLike ? String(errorLike.message) : '')).toLowerCase();
    const name = (err?.name ?? (errorLike ? String(errorLike.name) : '')).toLowerCase();

    // ネットワークエラー
    if (name === 'typeerror' && message.includes('fetch')) {
        return ErrorType.NETWORK;
    }
    if (message.includes('network') || message.includes('connection') || message.includes('timeout')) {
        return ErrorType.NETWORK;
    }

    // 認証エラー
    if (message.includes('401') || message.includes('unauthorized') || message.includes('api key')) {
        return ErrorType.AUTH;
    }
    if (message.includes('invalid api key') || message.includes('authentication')) {
        return ErrorType.AUTH;
    }

    // バリデーションエラー
    if (message.includes('invalid') || message.includes('validation') || message.includes('not allowed')) {
        return ErrorType.VALIDATION;
    }

    // Not Found
    if (message.includes('404') || message.includes('not found')) {
        return ErrorType.NOT_FOUND;
    }

    // レート制限
    if (message.includes('429') || message.includes('rate limit') || message.includes('too many')) {
        return ErrorType.RATE_LIMIT;
    }

    // サーバーエラー
    if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('server')) {
        return ErrorType.SERVER;
    }

    return ErrorType.UNKNOWN;
}

/**
 * ユーザー向けエラーメッセージを取得する
 * @param {Error} error - 発生したエラー
 * @returns {string} ユーザー向けメッセージ
 */
export function getUserMessage(error: unknown): string {
    const errorType = classifyError(error);
    return getUserMessageForType(errorType);
}

export interface ErrorResponse {
    success: boolean;
    error: string;
    errorType: ErrorTypeValues;
}

/**
 * エラーレスポンスオブジェクトを作成する
 * @param {Error} error - 発生したエラー
 * @param {Object} context - コンテキスト情報（ログ用）
 * @returns {ErrorResponse} レスポンスオブジェクト
 */
export function createErrorResponse(error: unknown, context: Record<string, unknown> = {}): ErrorResponse {
    const errorType = classifyError(error);
    const userMessage = getUserMessage(error);

    // ログには詳細情報を含める（ただしAPIキーなどの機密情報は除く）
    const err = error instanceof Error ? error : null;
    console.error('[Service Worker Error]', {
        type: errorType,
        name: err?.name,
        message: err?.message,
        context: sanitizeContext(context)
    });

    // ユーザーには簡潔なメッセージのみ返す
    return {
        success: false,
        error: userMessage,
        errorType: errorType
    };
}

/**
 * コンテキスト情報から機密情報を削除する
 * @param {Object} context - 元のコンテキスト
 * @returns {Object} サニタイズされたコンテキスト
 */
function sanitizeContext(context: Record<string, unknown>): Record<string, unknown> {
    if (!context || typeof context !== 'object') return {};

    const sanitized = { ...context };
    const sensitiveKeys = ['apiKey', 'api_key', 'password', 'token', 'secret', 'credential'];

    for (const key of Object.keys(sanitized)) {
        if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
            sanitized[key] = '[REDACTED]';
        }
    }

    return sanitized;
}

/**
 * 既知のエラーメッセージをユーザー向けに変換する
 * @param {string} errorMessage - 元のエラーメッセージ
 * @returns {string} ユーザー向けメッセージ
 */
export function convertKnownErrorMessage(errorMessage: string): string {
    if (!errorMessage || typeof errorMessage !== 'string') {
        return getUserMessageForType(ErrorType.UNKNOWN);
    }

    const lowerMessage = errorMessage.toLowerCase();

    // 既知のエラーパターンをマッピング
    const knownPatterns: Array<{ pattern: RegExp; messageKey: string }> = [
        { pattern: /url.*not allowed/i, messageKey: 'errorUrlNotAllowed' },
        { pattern: /domain.*block/i, messageKey: 'errorDomainBlocked' },
        { pattern: /url.*invalid/i, messageKey: 'errorInvalidUrlGeneric' },
        { pattern: /obsidian.*connection/i, messageKey: 'errorObsidianConnection' },
        { pattern: /daily note/i, messageKey: 'errorDailyNoteSave' },
        { pattern: /ai.*summar/i, messageKey: 'errorAiSummarize' },
        { pattern: /content.*empty/i, messageKey: 'errorContentEmpty' }
    ];

    for (const { pattern, messageKey } of knownPatterns) {
        if (pattern.test(lowerMessage)) {
            return chrome.i18n.getMessage(messageKey) || `Error: ${pattern}`;
        }
    }

    // 分類に基づいてメッセージを返す
    return getUserMessage({ message: errorMessage, name: 'Error' });
}
