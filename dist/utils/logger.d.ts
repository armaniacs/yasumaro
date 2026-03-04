/**
 * logger.ts
 * Structured Logging Utility with Error Codes
 * Stores logs in chrome.storage.local with 7-day retention policy.
 */
export declare const ErrorCode: {
    readonly STORAGE_READ_FAILURE: "STRG_RD_001";
    readonly STORAGE_WRITE_FAILURE: "STRG_WR_001";
    readonly STORAGE_KEY_NOT_FOUND: "STRG_NF_001";
    readonly STORAGE_MIGRATION_FAILURE: "STRG_MIG_001";
    readonly STORAGE_QUOTA_EXCEEDED: "STRG_QUOTA_001";
    readonly MIGRATION_ROLLBACK_FAILED: "STRG_ROLLBACK_001";
    readonly CRYPTO_DECRYPTION_FAILURE: "CRPT_DEC_001";
    readonly CRYPTO_ENCRYPTION_FAILURE: "CRPT_ENC_001";
    readonly CRYPTO_KEY_DERIVE_FAILURE: "CRPT_KEY_001";
    readonly CRYPTO_HASH_FAILURE: "CRPT_HSH_001";
    readonly CRYPTO_HMAC_FAILURE: "CRPT_HMAC_001";
    readonly API_REQUEST_FAILURE: "API_REQ_001";
    readonly API_TIMEOUT: "API_TIM_001";
    readonly API_RATE_LIMIT: "API_RL_001";
    readonly API_AUTH_FAILURE: "API_AUTH_001";
    readonly OBSIDIAN_CONNECT_FAILURE: "OBS_CONN_001";
    readonly OBSIDIAN_SEND_FAILURE: "OBS_SEND_001";
    readonly OBSIDIAN_RESPONSE_PARSE_FAILURE: "OBS_PARSE_001";
    readonly CONTENT_EXTRACTION_FAILURE: "CONT_EXT_001";
    readonly CONTENT_TRUNCATION: "CONT_TRUNC_001";
    readonly PII_DETECTION_FAILURE: "PII_DET_001";
    readonly PII_REDACTION_FAILURE: "PII_RED_001";
    readonly PRIVACY_MODE_VIOLATION: "PRIV_VIOL_001";
    readonly INVALID_INPUT: "VAL_INP_001";
    readonly MISSING_REQUIRED_FIELD: "VAL_REQ_001";
    readonly SETTINGS_IMPORT_FAILURE: "SET_IMP_001";
    readonly SETTINGS_EXPORT_FAILURE: "SET_EXP_001";
    readonly SETTINGS_SIGNATURE_FAILURE: "SET_SIG_001";
    readonly API_KEY_EXCLUDED: "SET_AK_EXCL_001";
    readonly API_KEY_MERGE_CONFLICT: "SET_AK_MRG_001";
    readonly UNKNOWN_ERROR: "UNKN_001";
    readonly INTERNAL_ERROR: "INT_001";
};
export type ErrorCodeValues = typeof ErrorCode[keyof typeof ErrorCode];
/**
 * 【機能概要】: 環境判定関数
 * 【実装方針】: process.env.NODE_ENVでdevelopmentかどうかを判定
 * 【テスト対応】: logger-production.test.ts
 * 🟡 信頼性レベル: 黄信号（環境変数による判定は一般的なパターンによる）
 * @returns {boolean} development環境の場合はtrue
 */
export declare const isDevelopment: () => boolean;
export declare const LogType: {
    readonly INFO: "INFO";
    readonly WARN: "WARN";
    readonly ERROR: "ERROR";
    readonly SANITIZE: "SANITIZE";
    readonly DEBUG: "DEBUG";
};
export type LogTypeValues = typeof LogType[keyof typeof LogType];
export interface LogEntry {
    id: string;
    timestamp: number;
    type: LogTypeValues;
    message: string;
    errorCode?: ErrorCodeValues;
    details?: Record<string, any>;
    source?: string;
    userId?: string;
}
/**
 * 【パフォーマンス改善】保留中のログをstorageにフラッシュする
 * @param {boolean} immediate - trueの場合は即時フラッシュ（テスト用）
 */
export declare function flushLogs(immediate?: boolean): Promise<void>;
/**
 * 【パフォーマンス改善】保留中のログの数を取得（テスト用）
 */
export declare function getPendingLogCount(): number;
/**
 * 【パフォーマンス改善】保留中のログをクリア（テスト用）
 */
export declare function clearPendingLogs(): void;
/**
 * Add a log entry
 * @param {LogTypeValues} type - LogType
 * @param {string} message - Log message
 * @param {object} [details] - Additional details (NO RAW PII)
 */
export declare function addLog(type: LogTypeValues, message: string, details?: Record<string, any>): Promise<void>;
/**
 * Get all logs (including pending logs)
 * @returns {Promise<LogEntry[]>}
 */
export declare function getLogs(): Promise<LogEntry[]>;
/**
 * Clear all logs
 */
export declare function clearLogs(): Promise<void>;
/**
 * 構造化されたINFOログを出力する
 * @param {string} message - メッセージ
 * @param {Record<string, any>} details - 詳細情報
 * @param {string} [source] - ログ出力元モジュール
 */
export declare function logInfo(message: string, details?: Record<string, any>, source?: string): Promise<void>;
/**
 * 構造化されたWARNログを出力する
 * @param {string} message - メッセージ
 * @param {Record<string, any>} details - 詳細情報
 * @param {ErrorCodeValues} [errorCode] - エラーコード
 * @param {string} [source] - ログ出力元モジュール
 */
export declare function logWarn(message: string, details?: Record<string, any>, errorCode?: ErrorCodeValues, source?: string): Promise<void>;
/**
 * 構造化されたERRORログを出力する
 * @param {string} message - メッセージ
 * @param {Record<string, any>} details - 詳細情報
 * @param {ErrorCodeValues} errorCode - エラーコード
 * @param {string} [source] - ログ出力元モジュール
 */
export declare function logError(message: string, details?: Record<string, any>, errorCode?: ErrorCodeValues, source?: string): Promise<void>;
/**
 * 構造化されたDEBUGログを出力する
 * @param {string} message - メッセージ
 * @param {Record<string, any>} details - 詳細情報
 * @param {string} [source] - ログ出力元モジュール
 */
export declare function logDebug(message: string, details?: Record<string, any>, source?: string): Promise<void>;
/**
 * 構造化されたSANITIZEログを出力する
 * @param {string} message - メッセージ
 * @param {Record<string, any>} details - 詳細情報
 * @param {ErrorCodeValues} [errorCode] - エラーコード
 * @param {string} [source] - ログ出力元モジュール
 */
export declare function logSanitize(message: string, details?: Record<string, any>, errorCode?: ErrorCodeValues, source?: string): Promise<void>;
//# sourceMappingURL=logger.d.ts.map