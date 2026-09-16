/**
 * offscreen.ts
 * Handles SQLite database operations in an offscreen document.
 *
 * Prompt API (window.ai / LanguageModel) is no longer handled here — Built-in AI
 * calls LanguageModel directly from the Service Worker (src/background/builtInAIClient.ts).
 */

import { engine } from './sqliteEngineHost.js';
import { errorMessage } from '../utils/errorUtils.js';
import { forwardWarn, forwardError } from './offscreenLogger.js';
import { isSqliteMessageType, type SqliteMessage } from '../messaging/sqliteMessages.js';
import { assertPayloadSize } from './payloadGuard.js';
import { sqliteMessageHandlers } from './sqliteMessageHandlers.js';
import { CLEANSING_OFFSCREEN_TYPE, handleCleansingOffscreenPayload } from './cleansingOffscreen.js';
import { setOpfsWorkerFactory } from './sqliteEngineContext/opfsWorkerProxy.js';
import { authorizeSqliteSender, type AuthorizedSqliteSender } from '../utils/extensionOrigin.js';

// For testing only - reset SQLite state
export const _resetSqliteForTesting = (): void => {
    engine.resetForTesting();
};

// AuthorizedSqliteSender is produced only by authorizeSqliteSender
// (src/utils/extensionOrigin.ts) — the SSOT for the SQLite sender policy.
// dispatchSqliteMessage requires one as a parameter, so a call site cannot
// reach the switch below without having passed that check — the coupling is
// enforced by the type checker, not by convention.

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
    // not from content scripts running in web pages. The sender policy
    // (content-script rejection + runtime id match) lives in
    // authorizeSqliteSender (src/utils/extensionOrigin.ts) — shared with the
    // background's senderTrust gate so Chrome and Firefox cannot diverge.
    const isSqliteMessage = isSqliteMessageType(msg.type);
    if (isSqliteMessage) {
      const auth = authorizeSqliteSender(_sender, chrome.runtime.id);
      if (!auth.ok) {
        sendResponse({
          success: false,
          error:
            auth.reason === 'content-script'
              ? 'Forbidden: SQLite operations are not available from content scripts.'
              : 'Forbidden: SQLite operations are not available from external extensions.',
        });
        return true;
      }
      void auth.proof;
    }

    // Only constructible here, after the sender authorization above — this is
    // the sole authorization proof dispatchSqliteMessage accepts.
    const authorizedSender: AuthorizedSqliteSender = { __brand: 'AuthorizedSqliteSender' };

    (async () => {
        try {
            if (isSqliteMessage) {
                // The listener is registered before the OPFS worker factory is
                // installed (see the registration below), so a message can
                // arrive first. Waiting here holds it until the engine can be
                // built, instead of refusing it at the transport layer.
                await factoryReady;
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

// Container wiring: on Chromium this module runs inside the offscreen
// document and pairs the engine with the bundled OPFS worker. On Firefox the
// same module is loaded by the background event page (no offscreen API) —
// the event page injects its own chrome.runtime.getURL-based worker factory
// BEFORE importing this module, so the bundled-worker factory (whose
// new Worker(new URL(...)) literal must not enter the background bundle) is
// skipped there.
const factoryReady: Promise<void> = import.meta.env.FIREFOX
  ? Promise.resolve()
  : import('./sqliteEngineContext/opfsWorkerFactory.js')
      .then((m) => setOpfsWorkerFactory(m.createOpfsWorkerFromBundle))
      .then(() => undefined)
      .catch((err: unknown) => {
        // Test environments stub chrome minimally (runtime.onMessage may lack
        // addListener); the registration below re-checks and skips instead of
        // crashing via an unhandled rejection.
        forwardError('Offscreen: OPFS worker factory setup failed', { error: errorMessage(err) }, 'offscreen');
      });

// Register synchronously, during module evaluation — NOT after factoryReady.
//
// chrome.offscreen.createDocument() resolves once the document exists, which
// says nothing about whether the script inside it has run. Deferring the
// listener behind factoryReady's dynamic import left a window in which the
// document was live but had no receiver, and any message sent into it came
// back as "Could not establish connection. Receiving end does not exist."
// Measured at ~2ms after createDocument() resolved, with the same document
// accepting messages normally ~50ms later (PBI 2026-09-16-02).
//
// The factory is instead awaited inside the handler, which was already async,
// so a message arriving early is queued rather than refused.
if (typeof globalThis.chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener(handleOffscreenMessage);
}
