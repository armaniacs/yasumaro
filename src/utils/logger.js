/**
 * logger.js
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
    SANITIZE: 'SANITIZE'
};

/**
 * Add a log entry
 * @param {string} type - LogType
 * @param {string} message - Log message
 * @param {object} [details] - Additional details (NO RAW PII)
 */
export async function addLog(type, message, details = {}) {
    try {
        const storage = await chrome.storage.local.get(LOG_STORAGE_KEY);
        let logs = storage[LOG_STORAGE_KEY] || [];

        const entry = {
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
 * @returns {Promise<Array>}
 */
export async function getLogs() {
    const storage = await chrome.storage.local.get(LOG_STORAGE_KEY);
    return storage[LOG_STORAGE_KEY] || [];
}

/**
 * Clear all logs
 */
export async function clearLogs() {
    await chrome.storage.local.remove(LOG_STORAGE_KEY);
}

/**
 * Filter out logs older than RETENTION_DAYS
 * @param {Array} logs 
 * @returns {Array}
 */
function pruneLogs(logs) {
    const cutoff = Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000);
    return logs.filter(log => log.timestamp > cutoff);
}

// Add global helper for testing
globalThis.reviewLogs = async () => {
    const logs = await getLogs();
    console.table(logs.map(l => ({
        time: new Date(l.timestamp).toLocaleString(navigator.language || 'en-US'),
        type: l.type,
        message: l.message,
        details: JSON.stringify(l.details)
    })));
};
