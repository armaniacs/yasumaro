/**
 * aiTestProgressNotifier.ts
 * Fire-and-forget push notification from the Service Worker to any open
 * extension page (Dashboard) about AIClient.testConnection() progress.
 *
 * This is intentionally kept outside the strict ExtensionMessage /
 * VALID_MESSAGE_TYPES request-response system (see messageTypes.ts):
 * it is a one-way broadcast with no sender awaiting a response, so folding
 * it into that discriminated union would force every request handler to
 * also handle a type it never expects to receive.
 */

import type { AiTestProgress } from './aiClient.js';

export const AI_TEST_PROGRESS_MESSAGE_TYPE = 'AI_TEST_PROGRESS' as const;

export interface AiTestProgressMessage {
    type: typeof AI_TEST_PROGRESS_MESSAGE_TYPE;
    progress: AiTestProgress;
}

/**
 * Notify any listening extension page of AI connection test progress.
 * Best-effort: if no page is listening (e.g. the Dashboard tab is closed),
 * chrome.runtime.sendMessage rejects with "Could not establish connection" —
 * that failure is expected and swallowed here.
 */
export function notifyAiTestProgress(progress: AiTestProgress): void {
    try {
        Promise.resolve(
            chrome.runtime.sendMessage({ type: AI_TEST_PROGRESS_MESSAGE_TYPE, progress } satisfies AiTestProgressMessage)
        ).catch(() => {});
    } catch {
        // sendMessage can throw synchronously (e.g. extension context invalidated).
    }
}
