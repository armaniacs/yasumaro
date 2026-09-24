/**
 * sqliteAlert.ts
 * Tracks consecutive SQLite failures and fires chrome.notifications
 * when a persistent failure threshold is reached.
 *
 * Initialization errors (OPFS unavailable, offscreen not ready) are
 * excluded from the critical alert to avoid noisy alerts during startup.
 */

import { LogType, ErrorCode } from '../utils/logger/types.js';
import { addLog } from '../utils/logger/core.js';
import { logCritical } from '../utils/logger/api.js';
import { ChromeNotificationCriticalSink } from '../utils/logger/criticalAlertSink.js';

const ALERT_THRESHOLD = 3;
const ALERT_COOLDOWN_MS = 60 * 60 * 1000;
/** Skip critical alert for errors matching these patterns during first 30s */
const INIT_GRACE_PERIOD_MS = 30_000;
const INIT_SUPPRESSED_PATTERNS = ['OPFS Worker unavailable', 'timed out', 'offscreen'];

/**
 * Session key for the alert counters. The service worker is ephemeral (MV3):
 * module variables alone lose the consecutive-failure count on every restart,
 * so the counters are written through to chrome.storage.session (which
 * survives SW restarts within the browser session) and rehydrated at module
 * load. A plain string key is used — this is SW-lifetime state, not a user
 * setting, so it stays out of StorageKeys/DEFAULT_SETTINGS.
 */
const SQLITE_ALERT_SESSION_KEY = 'sqliteAlertState';

interface SqliteAlertState {
    consecutiveFailures: number;
    lastAlertTime: number;
    firstFailureTime: number;
}

let consecutiveFailures = 0;
let lastAlertTime = 0;
let firstFailureTime = 0;

/** In-flight (or completed) rehydration; shared so concurrent callers join it. */
let restorePromise: Promise<void> | null = null;

function snapshot(): SqliteAlertState {
    return { consecutiveFailures, lastAlertTime, firstFailureTime };
}

function applySnapshot(state: SqliteAlertState): void {
    consecutiveFailures = state.consecutiveFailures;
    lastAlertTime = state.lastAlertTime;
    firstFailureTime = state.firstFailureTime;
}

async function persistSqliteAlertState(): Promise<void> {
    try {
        await chrome.storage.session.set({ [SQLITE_ALERT_SESSION_KEY]: snapshot() });
    } catch {
        // Best-effort; in-memory counters still protect this SW lifetime.
    }
}

/**
 * Rehydrate the alert counters after a service worker restart. Called once at
 * module load (module top-level code runs on every SW wake); callers that
 * need the restored values synchronously after a restart should await this.
 */
export function restoreSqliteAlertState(): Promise<void> {
    restorePromise ??= (async () => {
        try {
            const stored = await chrome.storage.session.get(SQLITE_ALERT_SESSION_KEY) as Record<string, SqliteAlertState | undefined>;
            const state = stored[SQLITE_ALERT_SESSION_KEY];
            if (
                state &&
                typeof state.consecutiveFailures === 'number' &&
                typeof state.lastAlertTime === 'number' &&
                typeof state.firstFailureTime === 'number'
            ) {
                applySnapshot(state);
            }
        } catch {
            // Unavailable session storage means a fresh count; keep zeros.
        }
    })();
    return restorePromise;
}

// SW wake re-runs module top-level code, so this rehydrates the counters that
// the previous SW lifetime persisted.
void restoreSqliteAlertState();

const criticalSink = new ChromeNotificationCriticalSink();

export function recordSqliteFailure(component: string, error: string): void {
    consecutiveFailures++;
    if (firstFailureTime === 0) firstFailureTime = Date.now();
    void persistSqliteAlertState();

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
            'sqliteAlert',
            criticalSink
        );
    }
}

export function recordSqliteSuccess(): void {
    consecutiveFailures = 0;
    firstFailureTime = 0;
    void persistSqliteAlertState();
}

function _resetForTesting(): void {
    consecutiveFailures = 0;
    lastAlertTime = 0;
    restorePromise = null;
    try {
        void chrome.storage.session.remove(SQLITE_ALERT_SESSION_KEY);
    } catch {
        // Test environments without session storage; in-memory reset suffices.
    }
}
