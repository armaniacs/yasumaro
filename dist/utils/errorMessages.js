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
};
/**
 * ユーザー向けエラーメッセージのマッピング
 * 技術的な詳細を含まない、ユーザーフレンドリーなメッセージ
 */
const USER_MESSAGES = {
    [ErrorType.NETWORK]: 'ネットワークエラーが発生しました。インターネット接続を確認してください。',
    [ErrorType.AUTH]: '認証エラーが発生しました。APIキーを確認してください。',
    [ErrorType.VALIDATION]: '入力内容が無効です。',
    [ErrorType.NOT_FOUND]: 'リソースが見つかりませんでした。',
    [ErrorType.RATE_LIMIT]: 'リクエスト制限に達しました。しばらく待ってから再試行してください。',
    [ErrorType.SERVER]: 'サーバーエラーが発生しました。しばらく待ってから再試行してください。',
    [ErrorType.UNKNOWN]: 'エラーが発生しました。'
};
/**
 * エラーを分類する
 * @param {Error} error - 発生したエラー
 * @returns {ErrorTypeValues} エラータイプ
 */
export function classifyError(error) {
    if (!error)
        return ErrorType.UNKNOWN;
    const message = (error.message || '').toLowerCase();
    const name = (error.name || '').toLowerCase();
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
export function getUserMessage(error) {
    const errorType = classifyError(error);
    return USER_MESSAGES[errorType] || USER_MESSAGES[ErrorType.UNKNOWN];
}
/**
 * エラーレスポンスオブジェクトを作成する
 * @param {Error} error - 発生したエラー
 * @param {Object} context - コンテキスト情報（ログ用）
 * @returns {ErrorResponse} レスポンスオブジェクト
 */
export function createErrorResponse(error, context = {}) {
    const errorType = classifyError(error);
    const userMessage = getUserMessage(error);
    // ログには詳細情報を含める（ただしAPIキーなどの機密情報は除く）
    console.error('[Service Worker Error]', {
        type: errorType,
        name: error.name,
        message: error.message,
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
function sanitizeContext(context) {
    if (!context || typeof context !== 'object')
        return {};
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
export function convertKnownErrorMessage(errorMessage) {
    if (!errorMessage || typeof errorMessage !== 'string') {
        return USER_MESSAGES[ErrorType.UNKNOWN];
    }
    const lowerMessage = errorMessage.toLowerCase();
    // 既知のエラーパターンをマッピング
    const knownPatterns = [
        { pattern: /url.*not allowed/i, message: 'このURLのアクセスは許可されていません。設定画面でベースURLが登録されているか確認してください。' },
        { pattern: /domain.*block/i, message: 'このドメインはブロックされています。' },
        { pattern: /url.*invalid/i, message: '無効なURLです。' },
        { pattern: /obsidian.*connection/i, message: 'Obsidianへの接続に失敗しました。Obsidianが起動していることを確認してください。' },
        { pattern: /daily note/i, message: 'デイリーノートへの保存に失敗しました。' },
        { pattern: /ai.*summar/i, message: 'AI要約の生成に失敗しました。' },
        { pattern: /content.*empty/i, message: 'ページのコンテンツが空です。' }
    ];
    for (const { pattern, message } of knownPatterns) {
        if (pattern.test(lowerMessage)) {
            return message;
        }
    }
    // 分類に基づいてメッセージを返す
    // const fakeError = { message: errorMessage, name: 'Error' };
    return getUserMessage({ message: errorMessage, name: 'Error' });
}
//# sourceMappingURL=errorMessages.js.map