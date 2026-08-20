// @layer Barrel — Re-export
/**
 * logger.ts
 * Structured Logging Utility with Error Codes — barrel re-export.
 * Stores logs in chrome.storage.local with 3-day retention policy.
 *
 * Implementation is split across logger/types.ts (error codes, log entry
 * types), logger/core.ts (buffering, sanitization, addLog/getLogs/clearLogs),
 * and logger/api.ts (logInfo/logWarn/logError/logDebug/logSanitize/logCritical).
 * This file remains as a stable import path for the ~120 existing call sites.
 *
 * @module logger
 */
export {
    ErrorCode,
    LogType,
} from './logger/types.js';
export type {
    ErrorCodeValues,
    ErrorCodePattern,
    LogTypeValues,
    LogEntry,
} from './logger/types.js';

export {
    isDevelopment,
    flushLogs,
    getPendingLogCount,
    clearPendingLogs,
    addLog,
    getLogs,
    clearLogs,
} from './logger/core.js';

export {
    extractSourceFromImportMetaUrl,
    logInfo,
    logWarn,
    logError,
    logDebug,
    logSanitize,
    logCritical,
} from './logger/api.js';
