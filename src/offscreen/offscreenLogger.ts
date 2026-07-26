/**
 * offscreenLogger.ts
 * Forwards log entries from the Offscreen Document to the Service Worker via
 * chrome.runtime.sendMessage, since Offscreen Documents cannot access
 * chrome.storage or import ../utils/logger.ts directly.
 *
 * Fire-and-forget: forwarding failures are swallowed (falling back to
 * console) so a broken message channel never blocks offscreen operations.
 */
import { CURRENT_PROTOCOL_VERSION } from '../background/messageTypes.js';

type LogLevel = 'warn' | 'error' | 'info';

function forwardLog(level: LogLevel, message: string, details?: Record<string, unknown>, source = 'offscreen'): void {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
        console[level === 'info' ? 'log' : level](`[${source}] ${message}`, details ?? '');
        return;
    }

    try {
        const result = chrome.runtime.sendMessage({
            type: 'LOG_FORWARD',
            protocolVersion: CURRENT_PROTOCOL_VERSION,
            payload: { level, message, details, source },
        });
        // sendMessage returns a Promise when no callback is passed; guard for
        // mocks/environments where it doesn't (e.g. callback-style or undefined).
        if (result && typeof (result as Promise<unknown>).catch === 'function') {
            (result as Promise<unknown>).catch(() => {
                // Service Worker may be asleep/unreachable; fall back to console so
                // the information is not silently lost.
                console[level === 'info' ? 'log' : level](`[${source}] ${message}`, details ?? '');
            });
        }
    } catch {
        console[level === 'info' ? 'log' : level](`[${source}] ${message}`, details ?? '');
    }
}

export function forwardWarn(message: string, details?: Record<string, unknown>, source?: string): void {
    forwardLog('warn', message, details, source);
}

export function forwardError(message: string, details?: Record<string, unknown>, source?: string): void {
    forwardLog('error', message, details, source);
}

export function forwardInfo(message: string, details?: Record<string, unknown>, source?: string): void {
    forwardLog('info', message, details, source);
}
