/**
 * redaction.ts
 * コンソールログの機密情報削除モジュール
 * APIキー、パスワードなどの機密情報をログ出力から保護
 */
const MAX_RECURSION_DEPTH = 100;
const SENSITIVE_KEYS = [
    'apiKey',
    'fullKey',
    'authToken',
    'auth',
    'password',
    'token',
    'api_key',
    'obsidian_api_key',
    'gemini_api_key',
    'openai_api_key',
    'openai_2_api_key',
    'master_password_hash',
    'hmac_secret',
];
/**
 * 再帰的に機密情報を削除する
 */
export function redactSensitiveData(data, depth = 0) {
    if (depth >= MAX_RECURSION_DEPTH) {
        return '[REDACTED: too deep]';
    }
    if (typeof data !== 'object' || data === null) {
        return data;
    }
    if (Array.isArray(data)) {
        return data.map(item => redactSensitiveData(item, depth + 1));
    }
    const result = {};
    for (const [key, value] of Object.entries(data)) {
        const isSensitiveKey = SENSITIVE_KEYS.some(sensitive => key.toLowerCase().includes(sensitive.toLowerCase()));
        if (isSensitiveKey) {
            result[key] = '[REDACTED]';
        }
        else if (typeof value === 'object' && value !== null) {
            result[key] = redactSensitiveData(value, depth + 1);
        }
        else {
            result[key] = value;
        }
    }
    return result;
}
/**
 * セキュアなエラーログを出力する
 */
export function consoleSecureError(message, data) {
    if (data !== undefined && data !== null) {
        const dataRedacted = redactSensitiveData(data);
        console.error(message, dataRedacted);
    }
    else {
        console.error(message);
    }
}
//# sourceMappingURL=redaction.js.map