/**
 * logger/api.ts
 * High-level structured logging functions (logInfo, logWarn, logError, logDebug,
 * logSanitize, logCritical) built on top of logger/core.ts's addLog/flushLogs.
 */
import { addLog, flushLogs, isDevelopment } from './core.js';
import { defaultCriticalSink, type CriticalAlertSink } from './criticalAlertSink.js';
import { ErrorCode, ErrorCodeValues, LogType, LogTypeValues } from './types.js';
import { sanitizeRegex } from '../piiSanitizer.js';

// 【SRE/Logging改善 #8】構造化ロギング便利関数

/**
 * Extract a short file name from an import.meta.url-style URL.
 * Strips query strings/fragments, removes the `.js` extension, and returns
 * the last path segment. Falls back to the original URL on parse errors.
 */
export function extractSourceFromImportMetaUrl(url: string): string {
    try {
        const parsed = new URL(url);
        const filename = parsed.pathname.split('/').pop() || 'unknown';
        return filename.replace(/\.(js|ts)$/i, '') || 'unknown';
    } catch {
        const fallback = url.split('/').pop() || 'unknown';
        return fallback.replace(/\.(js|ts)$/i, '') || 'unknown';
    }
}

/**
 * 構造化ログを書き込む（内部関数）
 * @param {LogTypeValues} type - ログタイプ
 * @param {string} message - メッセージ
 * @param {object} details - 詳細情報
 * @param {ErrorCodeValues} [errorCode] - エラーコード
 * @param {string} [source] - ログ出力元モジュール
 */
async function writeStructuredLog<T extends object = Record<string, unknown>>(
    type: LogTypeValues,
    message: string,
    details: T = {} as T,
    errorCode?: ErrorCodeValues,
    source?: string
): Promise<void> {
    try {
        await addLog(type, message, {
            ...details,
            _errorCode: errorCode,
            _source: source
        });
    } catch (e) {
        console.error('Logger: Failed to write structured log', e);
    }
}

/**
 * 構造化されたINFOログを出力する
 * @param {string} message - メッセージ
 * @param {Record<string, unknown>} details - 詳細情報
 * @param {string} [source] - ログ出力元モジュール
 */
export async function logInfo<T extends object = Record<string, unknown>>(
    message: string,
    details: T = {} as T,
    source?: string
): Promise<void> {
    await writeStructuredLog(LogType.INFO, message, details, undefined, source);
}

/**
 * 構造化されたWARNログを出力する
 * @param {string} message - メッセージ
 * @param {object} details - 詳細情報
 * @param {ErrorCodeValues} [errorCode] - エラーコード
 * @param {string} [source] - ログ出力元モジュール
 */
export async function logWarn<T extends object = Record<string, unknown>>(
    message: string,
    details: T = {} as T,
    errorCode?: ErrorCodeValues,
    source?: string
): Promise<void> {
    await writeStructuredLog(LogType.WARN, message, details, errorCode, source);
}

/**
 * 構造化されたERRORログを出力する
 * @param {string} message - メッセージ
 * @param {object} details - 詳細情報
 * @param {ErrorCodeValues} errorCode - エラーコード
 * @param {string} [source] - ログ出力元モジュール
 */
export async function logError<T extends object = Record<string, unknown>>(
    message: string,
    details: T = {} as T,
    errorCode: ErrorCodeValues = ErrorCode.UNKNOWN_ERROR,
    source?: string
): Promise<void> {
    await writeStructuredLog(LogType.ERROR, message, details, errorCode, source);

    // 開発環境ではconsole.errorにも出力
    if (isDevelopment()) {
        console.error(`[${errorCode}] ${message}`, details);
    }
}

/**
 * 構造化されたDEBUGログを出力する
 * @param {string} message - メッセージ
 * @param {object} details - 詳細情報
 * @param {string} [source] - ログ出力元モジュール
 */
export async function logDebug<T extends object = Record<string, unknown>>(
    message: string,
    details: T = {} as T,
    source?: string
): Promise<void> {
    // 本番環境ではDEBUGログを出力しない
    if (!isDevelopment()) {
        return;
    }
    await writeStructuredLog(LogType.DEBUG, message, details, undefined, source);

    // 開発環境ではconsole.debugにも出力
    if (isDevelopment()) {
        console.debug(`[DEBUG] ${message}`, details);
    }
}

/**
 * 構造化されたSANITIZEログを出力する
 * @param {string} message - メッセージ
 * @param {object} details - 詳細情報
 * @param {ErrorCodeValues} [errorCode] - エラーコード
 * @param {string} [source] - ログ出力元モジュール
 */
export async function logSanitize<T extends object = Record<string, unknown>>(
    message: string,
    details: T = {} as T,
    errorCode?: ErrorCodeValues,
    source?: string
): Promise<void> {
    await writeStructuredLog(LogType.SANITIZE, message, details, errorCode, source);
}

/**
 * CRITICAL — 構造化ERRORログ + 即時フラッシュ + 任意の CriticalAlertSink アラート
 * 暗号化失敗、データ損失リスクなど重大な障害で使用する。
 * 通知のクールダウンは sink 側で管理する。
 */
export async function logCritical<T extends object = Record<string, unknown>>(
    message: string,
    details: T = {} as T,
    errorCode: ErrorCodeValues = ErrorCode.UNKNOWN_ERROR,
    source?: string,
    sink: CriticalAlertSink = defaultCriticalSink,
): Promise<void> {
    await writeStructuredLog(LogType.ERROR, message, details, errorCode, source);
    // Critical logs are flushed immediately so they are not lost on SW termination.
    await flushLogs(true);

    console.error(`[CRITICAL:${errorCode}] ${message} ${JSON.stringify(details, (key, value) => {
        if (typeof value === 'string' && value.length > 128) {
            return value.slice(0, 128) + '...[truncated]';
        }
        if (typeof value === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) && value.length > 40) {
            return value.slice(0, 8) + '...[redacted]';
        }
        return value;
    })}`);

    // OS通知は chrome.storage への保存経路（addLog）とは別経路のため、
    // ここでも明示的にサニタイズする。addLog内のサニタイズは通知には効かない。
    const sanitizedMessage = await sanitizeRegex(message);
    const notificationMessage = sanitizedMessage.maskedItems.length > 0 ? sanitizedMessage.text : message;
    sink.raise(notificationMessage, details as Record<string, unknown>, errorCode);
}
