/**
 * logger.ts
 * Sanitization and Error Logging Utility
 * Stores logs in chrome.storage.local with 7-day retention policy.
 */
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
    details?: Record<string, any>;
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
//# sourceMappingURL=logger.d.ts.map