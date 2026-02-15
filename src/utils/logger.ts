/**
 * logger.ts
 * Sanitization and Error Logging Utility
 * Stores logs in chrome.storage.local with 7-day retention policy.
 */

const LOG_STORAGE_KEY = 'sanitization_logs';
const RETENTION_DAYS = 7;
const MAX_LOGS = 1000; // Prevent unlimited growth

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
    details?: Record<string, any>;
}

/**
 * Add a log entry
 * @param {LogTypeValues} type - LogType
 * @param {string} message - Log message
 * @param {object} [details] - Additional details (NO RAW PII)
 */
export async function addLog(type: LogTypeValues, message: string, details: Record<string, any> = {}): Promise<void> {
    try {
        const storage = await chrome.storage.local.get(LOG_STORAGE_KEY);
        let logs: LogEntry[] = storage[LOG_STORAGE_KEY] as LogEntry[] || [];

        const entry: LogEntry = {
            id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Math.random().toString(36).substring(2),
            timestamp: Date.now(),
            type,
            message,
            details
        };

        logs.push(entry);

        // Prune old logs immediately to keep storage clean
        logs = pruneLogs(logs);

        // Cap size
        if (logs.length > MAX_LOGS) {
            logs = logs.slice(logs.length - MAX_LOGS);
        }

        await chrome.storage.local.set({ [LOG_STORAGE_KEY]: logs });
    } catch (e) {
        console.error('Logger: Failed to save log', e);
    }
}

/**
 * Get all logs
 * @returns {Promise<LogEntry[]>}
 */
export async function getLogs(): Promise<LogEntry[]> {
    const storage = await chrome.storage.local.get(LOG_STORAGE_KEY);
    return (storage[LOG_STORAGE_KEY] as LogEntry[]) || [];
}

/**
 * Clear all logs
 */
export async function clearLogs(): Promise<void> {
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

// Add global helper for testing
(globalThis as any).reviewLogs = async () => {
    const logs = await getLogs();
    console.table(logs.map(l => ({
        time: new Date(l.timestamp).toLocaleString(navigator.language || 'en-US'),
        type: l.type,
        message: l.message,
        details: JSON.stringify(l.details)
    })));
};
