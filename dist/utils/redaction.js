/**
 * redaction.ts
 * コンソールログの機密情報削除モジュール
 * APIキー、パスワードなどの機密情報をログ出力から保護
 */
import { API_KEY_FIELDS } from './storageSettings.js';
const MAX_RECURSION_DEPTH = 100;
// Additional sensitive patterns beyond API keys
const ADDITIONAL_SENSITIVE_KEYS = [
    'apiKey',
    'fullKey',
    'authToken',
    'auth',
    'password',
    'token',
    'master_password_hash',
    'hmac_secret',
];
// Combine API keys with additional patterns for single source of truth
const SENSITIVE_KEYS = [
    ...API_KEY_FIELDS,
    ...ADDITIONAL_SENSITIVE_KEYS,
];
// Pre-lowercase for efficient matching (computed once at module load)
const LOWERCASE_SENSITIVE_KEYS = SENSITIVE_KEYS.map(k => k.toLowerCase());
/**
 * Check if a key is sensitive (case-insensitive)
 */
function isSensitiveKey(key) {
    const lowerKey = key.toLowerCase();
    return LOWERCASE_SENSITIVE_KEYS.some(sensitiveKey => lowerKey.includes(sensitiveKey));
}
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
        if (isSensitiveKey(key)) {
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