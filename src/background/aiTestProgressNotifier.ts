/**
 * aiTestProgressNotifier.ts
 * Fire-and-forget push notification from the Service Worker to any open
 * extension page (Dashboard) about AIClient.testConnection() progress.
 *
 * This is intentionally kept outside the strict ExtensionMessage /
 * VALID_MESSAGE_TYPES request-response system (see messageTypes.ts):
 * it is a one-way broadcast with no sender awaiting a response, so folding
 * it into that discriminated union would force every request handler to
 * also handle a type it never expects to receive. The message contract itself
 * is declared once in messageTypes.ts (AI_TEST_PROGRESS_MESSAGE_TYPE /
 * AiTestProgressMessage) and re-exported here for callers that import from
 * this module.
 */

import { addLog, LogType } from '../utils/logger.js';
import {
    AI_TEST_PROGRESS_MESSAGE_TYPE,
    type AiTestProgressMessage,
} from './messageTypes.js';

export { AI_TEST_PROGRESS_MESSAGE_TYPE, type AiTestProgressMessage };

/**
 * Notify any listening extension page of AI connection test progress.
 * Best-effort: if no page is listening (e.g. the Dashboard tab is closed),
 * chrome.runtime.sendMessage rejects with "Could not establish connection" —
 * that failure is expected and is recorded as a WARN log instead of thrown.
 */
export function notifyAiTestProgress(progress: AiTestProgressMessage['progress']): void {
    try {
        Promise.resolve(
            chrome.runtime.sendMessage({ type: AI_TEST_PROGRESS_MESSAGE_TYPE, progress } satisfies AiTestProgressMessage)
        ).catch((err: unknown) => {
            // No receiver listening (Dashboard closed / SW context invalidated).
            addLog(LogType.WARN, `AI_TEST_PROGRESS discard: ${String(err)}`);
        });
    } catch (err) {
        // sendMessage can throw synchronously (e.g. extension context invalidated).
        addLog(LogType.WARN, `AI_TEST_PROGRESS discard (sync): ${String(err)}`);
    }
}
