/**
 * offscreen.ts
 * Handles SQLite database operations in an offscreen document.
 *
 * Prompt API (window.ai / LanguageModel) is no longer handled here — Built-in AI
 * calls LanguageModel directly from the Service Worker (src/background/builtInAIClient.ts).
 * See dev-docs/2026-07-28-built-in-ai-provider-integration-design.md for the rationale.
 */

import { engine } from './sqliteEngineContext.js';
import { errorMessage } from '../utils/errorUtils.js';
import { forwardWarn, forwardError } from './offscreenLogger.js';
import { isSqliteMessageType, type SqliteMessage } from '../messaging/sqliteMessages.js';
import { assertPayloadSize } from './payloadGuard.js';
import { sqliteMessageHandlers } from './sqliteMessageHandlers.js';
import { CLEANSING_OFFSCREEN_TYPE, handleCleansingOffscreenPayload } from './cleansingOffscreen.js';

// For testing only - reset SQLite state
export const _resetSqliteForTesting = (): void => {
    engine.resetForTesting();
};

// Opaque marker produced only by handleOffscreenMessage's sender-authorization
// check (below). dispatchSqliteMessage requires one as a parameter, so a call
// site cannot reach the switch below without having passed that check —
// the coupling is enforced by the type checker, not by convention.
type AuthorizedSqliteSender = { readonly __brand: 'AuthorizedSqliteSender' };

// Dispatch a SqliteMessage (SW↔offscreen, see src/messaging/sqliteMessages.ts) to
// the matching handler via the registry Map with a common payload-size guard.
// The switch was replaced by Map lookup (shallow seam eliminated) and the
// previously scattered per-case size checks are now unified in payloadGuard.ts.
async function dispatchSqliteMessage(
    _authorized: AuthorizedSqliteSender,
    msg: SqliteMessage,
    sendResponse: (response: unknown) => void
): Promise<void> {
    const guardError = assertPayloadSize(msg);
    if (guardError) {
        sendResponse({ success: false, error: guardError });
        return;
    }

    const handler = sqliteMessageHandlers.get(msg.type);
    if (handler) {
        await handler(msg, sendResponse);
        return;
    }

    // If a new SqliteMessage variant is added without a registry entry,
    // it falls through here — the registry Map must stay in sync with
    // SQLITE_MESSAGE_TYPES (verified by the type check in sqliteMessages.ts).
    forwardWarn(`Offscreen: Unknown SQLite message type ${(msg as SqliteMessage).type}`);
    sendResponse({ success: false, error: 'Unknown message type' });
}

// Handle messages from the service worker
export function handleOffscreenMessage(
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
): boolean {
    if (typeof message !== 'object' || message === null || !('target' in message)) return false;
    const msg = message as { target: string; type: string; payload?: Record<string, unknown> };
    if (msg.target !== 'offscreen') return false;

    // Security: SQLite operations must only come from the service worker,
    // not from content scripts running in web pages (which would have a tab)
    // or from external extensions.
    const isSqliteMessage = isSqliteMessageType(msg.type);
    if (isSqliteMessage) {
      // Block content scripts (which have a tab)
      if (_sender.tab) {
        sendResponse({
          success: false,
          error: 'Forbidden: SQLite operations are not available from content scripts.',
        });
        return true;
      }
      // Block external extensions (sender.id must match our extension)
      if (_sender.id !== chrome.runtime.id) {
        sendResponse({
          success: false,
          error: 'Forbidden: SQLite operations are not available from external extensions.',
        });
        return true;
      }
    }

    // Only constructible here, after both checks above have passed — this is
    // the sole authorization proof dispatchSqliteMessage accepts.
    const authorizedSender: AuthorizedSqliteSender = { __brand: 'AuthorizedSqliteSender' };

    (async () => {
        try {
            if (isSqliteMessage) {
                // Cast is safe: isSqliteMessage narrowed msg.type via isSqliteMessageType
                // above, so msg.type is a known SqliteMessageType at this point. Payload
                // shape itself is not runtime-validated here (same trust boundary as
                // before this refactor: the sender is verified to be our own SW).
                await dispatchSqliteMessage(authorizedSender, msg as SqliteMessage, sendResponse);

            } else if (msg.type === CLEANSING_OFFSCREEN_TYPE) {
                // Cleansing delegation is allowed from content scripts (sender.tab may be present)
                // so it does not go through the SQLite sender authorization check.
                const res = handleCleansingOffscreenPayload(msg.payload as unknown);
                sendResponse(res);
                return;
            } else {
                const traceId = isSqliteMessageType(msg.type) ? (msg as SqliteMessage).traceId : undefined;
                forwardWarn(`Offscreen: Unknown message type ${msg.type}`, {}, 'offscreen', traceId);
                sendResponse({ success: false, error: 'Unknown message type' });
            }
        } catch (err: unknown) {
            const traceId = isSqliteMessageType(msg.type) ? (msg as SqliteMessage).traceId : undefined;
            forwardError('Offscreen: Unexpected error', { error: errorMessage(err) }, 'offscreen', traceId);
            sendResponse({ success: false, error: errorMessage(err) });
        }
    })();

    return true; // Keep channel open for async response
}

if (typeof globalThis.chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener(handleOffscreenMessage);
}
