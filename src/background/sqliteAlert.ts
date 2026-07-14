/**
 * sqliteAlert.ts
 * Tracks consecutive SQLite failures and fires chrome.notifications
 * when a persistent failure threshold is reached.
 *
 * Initialization errors (OPFS unavailable, offscreen not ready) are
 * excluded from the critical alert to avoid noisy alerts during startup.
 */

import { addLog, LogType, ErrorCode, logCritical } from '../utils/logger.js';

const ALERT_THRESHOLD = 3;
const ALERT_COOLDOWN_MS = 60 * 60 * 1000;
/** Skip critical alert for errors matching these patterns during first 30s */
const INIT_GRACE_PERIOD_MS = 30_000;
const INIT_SUPPRESSED_PATTERNS = ['OPFS Worker unavailable', 'timed out', 'offscreen'];

let consecutiveFailures = 0;
let lastAlertTime = 0;
let firstFailureTime = 0;

export function recordSqliteFailure(component: string, error: string): void {
    consecutiveFailures++;
    if (firstFailureTime === 0) firstFailureTime = Date.now();

    addLog(LogType.ERROR, `SqliteAlert: ${component} failure`, {
        consecutiveFailures,
        error,
        _errorCode: ErrorCode.STORAGE_READ_FAILURE,
        _source: 'sqliteAlert',
    });

    // During initialization grace period, suppress critical alerts for known init errors
    const elapsed = Date.now() - firstFailureTime;
    const isInitError = elapsed < INIT_GRACE_PERIOD_MS &&
        INIT_SUPPRESSED_PATTERNS.some(p => error.includes(p));

    if (!isInitError &&
        consecutiveFailures >= ALERT_THRESHOLD &&
        Date.now() - lastAlertTime > ALERT_COOLDOWN_MS) {
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
    firstFailureTime = 0;
}

export function getConsecutiveFailureCount(): number {
    return consecutiveFailures;
}

export function _resetForTesting(): void {
    consecutiveFailures = 0;
    lastAlertTime = 0;
}
