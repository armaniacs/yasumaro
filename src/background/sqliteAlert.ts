/**
 * sqliteAlert.ts
 * Tracks consecutive SQLite failures and fires chrome.notifications
 * when a persistent failure threshold is reached.
 */

import { addLog, LogType, ErrorCode, logCritical } from '../utils/logger.js';

const ALERT_THRESHOLD = 3;
const ALERT_COOLDOWN_MS = 60 * 60 * 1000;

let consecutiveFailures = 0;
let lastAlertTime = 0;

export function recordSqliteFailure(component: string, error: string): void {
    consecutiveFailures++;

    addLog(LogType.ERROR, `SqliteAlert: ${component} failure`, {
        consecutiveFailures,
        error,
        _errorCode: ErrorCode.STORAGE_READ_FAILURE,
        _source: 'sqliteAlert',
    });

    if (consecutiveFailures >= ALERT_THRESHOLD && Date.now() - lastAlertTime > ALERT_COOLDOWN_MS) {
        lastAlertTime = Date.now();
        consecutiveFailures = 0;

        void logCritical(
            `SQLite persistent failure in ${component}`,
            { component, totalFailures: ALERT_THRESHOLD, lastError: error },
            ErrorCode.STORAGE_READ_FAILURE,
            'sqliteAlert'
        );
    }
}

export function recordSqliteSuccess(): void {
    consecutiveFailures = 0;
}

export function getConsecutiveFailureCount(): number {
    return consecutiveFailures;
}

export function _resetForTesting(): void {
    consecutiveFailures = 0;
    lastAlertTime = 0;
}
