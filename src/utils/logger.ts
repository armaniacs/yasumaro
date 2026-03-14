/**
 * logger.ts
 * Structured Logging Utility with Error Codes
 * Stores logs in chrome.storage.local with 7-day retention policy.
 */

import { sanitizeRegex } from './piiSanitizer.js';

// エラーコード定義（SRE/Logging改善 #8）
export const ErrorCode = {
    // ストレージ関連
    STORAGE_READ_FAILURE: 'STRG_RD_001',
    STORAGE_WRITE_FAILURE: 'STRG_WR_001',
    STORAGE_KEY_NOT_FOUND: 'STRG_NF_001',
    STORAGE_MIGRATION_FAILURE: 'STRG_MIG_001',
    STORAGE_QUOTA_EXCEEDED: 'STRG_QUOTA_001',
    MIGRATION_ROLLBACK_FAILED: 'STRG_ROLLBACK_001',

    // 暗号化関連
    CRYPTO_DECRYPTION_FAILURE: 'CRPT_DEC_001',
    CRYPTO_ENCRYPTION_FAILURE: 'CRPT_ENC_001',
    CRYPTO_KEY_DERIVE_FAILURE: 'CRPT_KEY_001',
    CRYPTO_HASH_FAILURE: 'CRPT_HSH_001',
    CRYPTO_HMAC_FAILURE: 'CRPT_HMAC_001',

    // API通信関連
    API_REQUEST_FAILURE: 'API_REQ_001',
    API_TIMEOUT: 'API_TIM_001',
    API_RATE_LIMIT: 'API_RL_001',
    API_AUTH_FAILURE: 'API_AUTH_001',

    // Obsidian通信関連
    OBSIDIAN_CONNECT_FAILURE: 'OBS_CONN_001',
    OBSIDIAN_SEND_FAILURE: 'OBS_SEND_001',
    OBSIDIAN_RESPONSE_PARSE_FAILURE: 'OBS_PARSE_001',

    // コンテンツ抽出関連
    CONTENT_EXTRACTION_FAILURE: 'CONT_EXT_001',
    CONTENT_TRUNCATION: 'CONT_TRUNC_001',

    // PII/プライバシー関連
    PII_DETECTION_FAILURE: 'PII_DET_001',
    PII_REDACTION_FAILURE: 'PII_RED_001',
    PRIVACY_MODE_VIOLATION: 'PRIV_VIOL_001',

    // 入力検証関連
    INVALID_INPUT: 'VAL_INP_001',
    MISSING_REQUIRED_FIELD: 'VAL_REQ_001',

    // 設定管理関連
    SETTINGS_IMPORT_FAILURE: 'SET_IMP_001',
    SETTINGS_EXPORT_FAILURE: 'SET_EXP_001',
    SETTINGS_SIGNATURE_FAILURE: 'SET_SIG_001',

    // APIキー管理関連
    API_KEY_EXCLUDED: 'SET_AK_EXCL_001',
    API_KEY_MERGE_CONFLICT: 'SET_AK_MRG_001',

    // Trust Database関連（Phase 1）
    TRUST_DB_INIT_FAILED: 'TRUST_INIT_001',
    TRUST_DB_NOT_INITIALIZED: 'TRUST_NOT_INIT_001',
    TRANC_FETCH_FAILED: 'TRANC_FETCH_001',
    TRANC_PARSE_FAILED: 'TRANC_PARSE_001',
    BLOOM_FILTER_ERROR: 'BLM_FLT_001',

    // 汎用エラー
    UNKNOWN_ERROR: 'UNKN_001',
    INTERNAL_ERROR: 'INT_001',

    // UI/Badge関連
    BADGE_UPDATE_FAILED: 'UI_BADGE_001'
} as const;

export type ErrorCodeValues = typeof ErrorCode[keyof typeof ErrorCode];

const LOG_STORAGE_KEY = 'sanitization_logs';
const RETENTION_DAYS = 7;
const MAX_LOGS = 1000; // Prevent unlimited growth

// 【セキュリティ強化】log sanitizationへの深度制限と循環参照保護
const MAX_RECURSION_DEPTH = 100; // redaction.tsと整合
const SANITIZE_RESULT = {
  TOO_DEEP: '[SANITIZED: too deep]',
  CIRCULAR_REF: '[SANITIZED: circular reference]'
} as const;

// 【パフォーマンス改善】バッチ書き込み用設定
const BATCH_FLUSH_SIZE = 10; // バッファがこのサイズを超えるとフラッシュ
const BATCH_FLUSH_DELAY_MS = 5000; // 5秒間書き込みがないとフラッシュ
const MAX_PENDING_LOGS = 100; // バッファ上限（メモリリーク防止）
let pendingLogs: LogEntry[] = []; // 保留中のログバッファ
let flushTimer: number | NodeJS.Timeout | null = null; // フラッシュ遅延タイマー
let isFlushing = false; // フラッシュ中フラグ（多重フラッシュ防止）

/**
 * 【機能概要】: 環境判定関数
 * 【実装方針】: process.env.NODE_ENVでdevelopmentかどうかを判定
 * 【テスト対応】: logger-production.test.ts
 * 🟡 信頼性レベル: 黄信号（環境変数による判定は一般的なパターンによる）
 * @returns {boolean} development環境の場合はtrue
 */
export const isDevelopment = (): boolean => {
  return typeof process !== 'undefined' && (process.env.NODE_ENV as string) === 'development';
};

export const LogType = {
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR',
    SANITIZE: 'SANITIZE',
    DEBUG: 'DEBUG'
} as const;

export type LogTypeValues = typeof LogType[keyof typeof LogType];

export interface LogEntry {
    id: string;
    timestamp: number;
    type: LogTypeValues;
    message: string;
    errorCode?: ErrorCodeValues;
    details?: Record<string, any>;
    source?: string; // ログ出力元モジュール
    userId?: string; // ユーザー識別子（匿名化済み）
}

/**
 * 【パフォーマンス改善】保留中のログをstorageにフラッシュする
 * @param {boolean} immediate - trueの場合は即時フラッシュ（テスト用）
 */
export async function flushLogs(immediate: boolean = false): Promise<void> {
    if (isFlushing || pendingLogs.length === 0) {
        return;
    }

    isFlushing = true;

    try {
        // バッファの内容をコピーしてクリア
        const logsToFlush = [...pendingLogs];
        pendingLogs = [];

        // タイマーをクリア
        if (flushTimer !== null) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }

        // 既存ログを取得
        const storage = await chrome.storage.local.get(LOG_STORAGE_KEY);
        let logs: LogEntry[] = storage[LOG_STORAGE_KEY] as LogEntry[] || [];

        // 新しいログを追加
        logs.push(...logsToFlush);

        // 古いログを削除
        logs = pruneLogs(logs);

        // サイズ制限
        if (logs.length > MAX_LOGS) {
            logs = logs.slice(logs.length - MAX_LOGS);
        }

        // storageに保存
        await chrome.storage.local.set({ [LOG_STORAGE_KEY]: logs });
    } catch (e) {
        console.error('Logger: Failed to flush logs', e);
    } finally {
        isFlushing = false;
    }
}

/**
 * 【パフォーマンス改善】保留中のログをスケジュールしてフラッシュする
 */
function scheduleFlush(): void {
    if (flushTimer !== null) {
        clearTimeout(flushTimer);
    }

    flushTimer = setTimeout(() => {
        flushLogs();
    }, BATCH_FLUSH_DELAY_MS) as unknown as number;
}

/**
 * 【パフォーマンス改善】保留中のログの数を取得（テスト用）
 */
export function getPendingLogCount(): number {
    return pendingLogs.length;
}

/**
 * 【パフォーマンス改善】保留中のログをクリア（テスト用）
 */
export function clearPendingLogs(): void {
    pendingLogs = [];
}

/**
 * ログの詳細情報をサニタイズする（PII検出とマスキング）
 * 【深度制限と循環参照保護】
 * @param {Record<string, any>} details - サニタイズ対象の詳細情報
 * @param {WeakSet<object>} [visitedObjects] - 循環参照検出用WeakSet
 * @param {number} [depth] - 現在の再帰深度
 * @returns {Record<string, any>} サニタイズ済みの詳細情報
 */
async function sanitizeLogDetails(
    details: Record<string, any>,
    visitedObjects?: WeakSet<object>,
    depth = 0
): Promise<Record<string, any>> {
    // 入力チェック
    if (details === null || details === undefined) {
        return details;
    }

    if (typeof details !== 'object') {
        throw new Error(`Expected object, got ${typeof details}`);
    }

    // 循環参照検出の初期化
    if (typeof WeakSet !== 'undefined' && !visitedObjects) {
        visitedObjects = new WeakSet<object>();
    }

    // 深度制限チェック
    if (depth >= MAX_RECURSION_DEPTH) {
        return SANITIZE_RESULT.TOO_DEEP as any;
    }

    // 循環参照検出
    if (visitedObjects && visitedObjects.has(details)) {
        return SANITIZE_RESULT.CIRCULAR_REF as any;
    }

    // メタオブジェクトは文字列化
    if (details instanceof Date) {
        return details.toISOString() as any;
    }

    if (details instanceof Error) {
        return { message: details.message, stack: details.stack } as any;
    }

    // WeakSetに現在のオブジェクトを追加
    if (visitedObjects) {
        visitedObjects.add(details);
    }

    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(details)) {
        if (value === null || value === undefined) {
            sanitized[key] = value;
            continue;
        }

        // 文字列値の場合はPII検出を実行
        if (typeof value === 'string') {
            const result = await sanitizeRegex(value);
            if (result.maskedItems.length > 0) {
                sanitized[key] = result.text;
                sanitized[`${key}_maskedTypes`] = result.maskedItems.map((m: any) => m.type);
            } else {
                sanitized[key] = value;
            }
        } else if (typeof value === 'object') {
            // 配列の明示的な処理
            if (Array.isArray(value)) {
                sanitized[key] = await sanitizeArray(value, visitedObjects, depth + 1);
            } else {
                // オブジェクトの場合は再帰的に処理
                sanitized[key] = await sanitizeLogDetails(value as Record<string, any>, visitedObjects, depth + 1);
            }
        } else {
            sanitized[key] = value; // primitive types
        }
    }

    return sanitized;
}

/**
 * 配列を再帰的にサニタイズする（ヘルパー関数）
 */
async function sanitizeArray(
    arr: any[],
    visitedObjects?: WeakSet<object>,
    depth = 0
): Promise<any> {
    // 深度制限チェック
    if (depth >= MAX_RECURSION_DEPTH) {
        return SANITIZE_RESULT.TOO_DEEP;
    }

    // 循環参照検出
    if (visitedObjects && visitedObjects.has(arr)) {
        return SANITIZE_RESULT.CIRCULAR_REF;
    }

    // WeakSetに配列を追加
    if (visitedObjects) {
        visitedObjects.add(arr);
    }

    const sanitized: any[] = [];

    for (const item of arr) {
        if (item === null || item === undefined) {
            sanitized.push(item);
            continue;
        }

        if (typeof item === 'string') {
            const result = await sanitizeRegex(item);
            if (result.maskedItems.length > 0) {
                sanitized.push(result.text);
            } else {
                sanitized.push(item);
            }
        } else if (typeof item === 'object') {
            if (Array.isArray(item)) {
                sanitized.push(await sanitizeArray(item, visitedObjects, depth + 1));
            } else {
                // メタオブジェクトのチェック
                if (item instanceof Date) {
                    sanitized.push(item.toISOString());
                } else if (item instanceof Error) {
                    sanitized.push({ message: item.message, stack: item.stack });
                } else {
                    sanitized.push(await sanitizeLogDetails(item as Record<string, any>, visitedObjects, depth + 1) as any);
                }
            }
        } else {
            sanitized.push(item); // primitive types
        }
    }

    return sanitized;
}

/**
 * Add a log entry
 * @param {LogTypeValues} type - LogType
 * @param {string} message - Log message
 * @param {object} [details] - Additional details (NO RAW PII)
 */
export async function addLog(type: LogTypeValues, message: string, details: Record<string, any> = {}): Promise<void> {
    try {
        // 【セキュリティ強化】本番環境ではDEBUGログを破棄
        // 【実装方針】: isDevelopment()で環境判定し、本番ならDEBUGを早期return
        // 【テスト対応**: logger-production.test.ts - 本番環境のDEBUGログが出力されない
        // 🟡 信頼性レベル: 黄信号（要件定義書のログ制約による）
        if (!isDevelopment() && type === 'DEBUG') {
            return; // DEBUGログは保存せず破棄
        }

        const entry: LogEntry = {
            id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Math.random().toString(36).substring(2),
            timestamp: Date.now(),
            type,
            message,
            details: await sanitizeLogDetails(details)
        };

        // バッファに追加（上限超過時は古いエントリを破棄）
        if (pendingLogs.length >= MAX_PENDING_LOGS) {
            // slice(1) creates new array but avoids in-place shifting
            pendingLogs = pendingLogs.slice(1);
        }
        pendingLogs.push(entry);

        // 【パフォーマンス改善】フラッシュ条件をチェック
        if (pendingLogs.length >= BATCH_FLUSH_SIZE) {
            await flushLogs();
        } else {
            scheduleFlush();
        }
    } catch (e) {
        console.error('Logger: Failed to save log', e);
    }
}

/**
 * Get all logs (including pending logs)
 * @returns {Promise<LogEntry[]>}
 */
export async function getLogs(): Promise<LogEntry[]> {
    const storage = await chrome.storage.local.get(LOG_STORAGE_KEY);
    const storedLogs = (storage[LOG_STORAGE_KEY] as LogEntry[]) || [];
    return [...storedLogs, ...pendingLogs];
}

/**
 * Clear all logs
 */
export async function clearLogs(): Promise<void> {
    pendingLogs = []; // 保留中のログもクリア
    if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }
    await chrome.storage.local.remove(LOG_STORAGE_KEY);
}

/**
 * Filter out logs older than RETENTION_DAYS
 * @param {LogEntry[]} logs
 * @returns {LogEntry[]}
 */
function pruneLogs(logs: LogEntry[]): LogEntry[] {
    const cutoff = Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000);
    return logs.filter(log => log.timestamp > cutoff);
}

// 【SRE/Logging改善 #8】構造化ロギング便利関数

/**
 * 構造化されたログエントリを作成する（内部関数）
 * @param {LogTypeValues} type - ログタイプ
 * @param {string} message - メッセージ
 * @param {Record<string, any>} details - 詳細情報
 * @param {ErrorCodeValues} [errorCode] - エラーコード
 * @param {string} [source] - ログ出力元モジュール
 * @returns {LogEntry} ログエントリ
 */
function createStructuredLog(
    type: LogTypeValues,
    message: string,
    details: Record<string, any> = {},
    errorCode?: ErrorCodeValues,
    source?: string
): LogEntry {
    return {
        id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Math.random().toString(36).substring(2),
        timestamp: Date.now(),
        type,
        message,
        errorCode,
        source,
        details
    };
}

/**
 * 構造化されたINFOログを出力する
 * @param {string} message - メッセージ
 * @param {Record<string, any>} details - 詳細情報
 * @param {string} [source] - ログ出力元モジュール
 */
export async function logInfo(
    message: string,
    details: Record<string, any> = {},
    source?: string
): Promise<void> {
    const entry = createStructuredLog(LogType.INFO, message, details, undefined, source);
    await writeStructuredLog(entry);
}

/**
 * 構造化されたWARNログを出力する
 * @param {string} message - メッセージ
 * @param {Record<string, any>} details - 詳細情報
 * @param {ErrorCodeValues} [errorCode] - エラーコード
 * @param {string} [source] - ログ出力元モジュール
 */
export async function logWarn(
    message: string,
    details: Record<string, any> = {},
    errorCode?: ErrorCodeValues,
    source?: string
): Promise<void> {
    const entry = createStructuredLog(LogType.WARN, message, details, errorCode, source);
    await writeStructuredLog(entry);
}

/**
 * 構造化されたERRORログを出力する
 * @param {string} message - メッセージ
 * @param {Record<string, any>} details - 詳細情報
 * @param {ErrorCodeValues} errorCode - エラーコード
 * @param {string} [source] - ログ出力元モジュール
 */
export async function logError(
    message: string,
    details: Record<string, any> = {},
    errorCode: ErrorCodeValues = ErrorCode.UNKNOWN_ERROR,
    source?: string
): Promise<void> {
    const entry = createStructuredLog(LogType.ERROR, message, details, errorCode, source);
    await writeStructuredLog(entry);

    // 開発環境ではconsole.errorにも出力
    if (isDevelopment()) {
        console.error(`[${errorCode}] ${message}`, details);
    }
}

/**
 * 構造化されたDEBUGログを出力する
 * @param {string} message - メッセージ
 * @param {Record<string, any>} details - 詳細情報
 * @param {string} [source] - ログ出力元モジュール
 */
export async function logDebug(
    message: string,
    details: Record<string, any> = {},
    source?: string
): Promise<void> {
    // 本番環境ではDEBUGログを出力しない
    if (!isDevelopment()) {
        return;
    }
    const entry = createStructuredLog(LogType.DEBUG, message, details, undefined, source);
    await writeStructuredLog(entry);

    // 開発環境ではconsole.debugにも出力
    if (isDevelopment()) {
        console.debug(`[DEBUG] ${message}`, details);
    }
}

/**
 * 構造化されたSANITIZEログを出力する
 * @param {string} message - メッセージ
 * @param {Record<string, any>} details - 詳細情報
 * @param {ErrorCodeValues} [errorCode] - エラーコード
 * @param {string} [source] - ログ出力元モジュール
 */
export async function logSanitize(
    message: string,
    details: Record<string, any> = {},
    errorCode?: ErrorCodeValues,
    source?: string
): Promise<void> {
    const entry = createStructuredLog(LogType.SANITIZE, message, details, errorCode, source);
    await writeStructuredLog(entry);
}

/**
 * 構造化ログを書き込む（内部関数）
 * @param {LogEntry} entry - ログエントリ
 */
async function writeStructuredLog(entry: LogEntry): Promise<void> {
    try {
        const { id, timestamp, type, message, errorCode, source, details } = entry;

        // 既存のaddLog関数を使用（entryを分割して渡す）
        await addLog(
            type,
            message,
            {
                ...details,
                _errorCode: errorCode,
                _source: source
            }
        );
    } catch (e) {
        console.error('Logger: Failed to write structured log', e);
    }
}
