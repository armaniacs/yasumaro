/**
 * logger.ts
 * Sanitization and Error Logging Utility
 * Stores logs in chrome.storage.local with 7-day retention policy.
 */
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
 * Add a log entry
 * @param {LogTypeValues} type - LogType
 * @param {string} message - Log message
 * @param {object} [details] - Additional details (NO RAW PII)
 */
export declare function addLog(type: LogTypeValues, message: string, details?: Record<string, any>): Promise<void>;
/**
 * Get all logs
 * @returns {Promise<LogEntry[]>}
 */
export declare function getLogs(): Promise<LogEntry[]>;
/**
 * Clear all logs
 */
export declare function clearLogs(): Promise<void>;
//# sourceMappingURL=logger.d.ts.map