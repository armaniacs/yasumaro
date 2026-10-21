/**
 * sessionLockReceiver.ts
 * Deep module for the receiving end of the SESSION_LOCK_REQUEST fan-out:
 * the message-shape guard, the lock-state re-read, the key-cache drop, and
 * the response-body contract live here so popup and dashboard both become
 * real fan-out destinations without re-implementing them.
 *
 * Sender contract (parent PBI 2026-10-18-20, SessionAlarmService.lockSession):
 * chrome.runtime.sendMessage is never delivered to the sender's own context
 * (the platform fact recorded in privacyConsent.ts), so the service worker's
 * own MessageRouter handler cannot receive this send and extension pages are
 * the real destinations. The sender judges success ONLY by the response body
 * ({ success: true }): a receiver-less fan-out also resolves, so answering
 * the body is what marks a lock as confirmed, and a failing receiver keeps
 * the 3-attempt / 2-wait retry semantics alive by answering { success: false }
 * instead of leaving the message port open.
 */

import { errorMessage } from '../errorUtils.js';
import { logWarn } from '../logger/api.js';

/**
 * Runtime shape guard for SESSION_LOCK_REQUEST: the fan-out reaches every
 * extension context, so only the envelope the sender actually puts on the
 * wire ({ type: 'SESSION_LOCK_REQUEST', protocolVersion }, see
 * background/messageTypes.ts) may trigger a lock transition here.
 */
export function isSessionLockRequestMessage(message: unknown): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'SESSION_LOCK_REQUEST'
  );
}

/**
 * Seam for one received SESSION_LOCK_REQUEST. Injected so the lock state
 * transition is unit-testable without chrome globals; the popup and the
 * dashboard wire the real authGuard read and the real key-cache drop.
 */
export interface SessionLockReceiverDeps {
  /**
   * Re-reads the authGuard lock state for this context. Storage decides:
   * SESSION_LOCK_REQUEST carries no payload, so this re-read is the only
   * source of truth for whether the page transitions to locked.
   */
  isLocked: () => Promise<boolean>;
  /** Drops this context's cached encryption key (clearEncryptionKeyCache). */
  clearKeyCache: () => void;
  /**
   * UI transition callback for surfaces that display the lock state, fired
   * only when this page transitions to locked. Omit for contexts with no
   * lock UI, where the key-cache drop is the whole effect.
   */
  onLocked?: () => void;
}

/**
 * Handles one received SESSION_LOCK_REQUEST. The lock decision comes from
 * the injected isLocked read, never from the message body: a locked re-read
 * drops the key cache and fires the UI transition, an unlocked one is a
 * no-op. Returns whether the message was a lock request handled by this
 * receiver — the caller owes the sender a response body either way.
 */
export async function handleSessionLockRequest(
  message: unknown,
  deps: SessionLockReceiverDeps,
): Promise<boolean> {
  if (!isSessionLockRequestMessage(message)) return false;
  const locked = await deps.isLocked();
  if (locked) {
    deps.clearKeyCache();
    deps.onLocked?.();
  }
  return true;
}

/**
 * Subscribes this extension page to the SESSION_LOCK_REQUEST fan-out.
 * The listener confirms delivery with the response body: { success: true }
 * after the re-read settles, or { success: false } when the re-read fails
 * so the sender's retry contract decides the outcome. Call the returned
 * function to remove the listener (page destroy / unload).
 */
export function subscribeSessionLockRequest(deps: SessionLockReceiverDeps): () => void {
  // Non-extension contexts (and tests without a runtime mock) stay a no-op.
  if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) {
    return () => undefined;
  }

  const listener = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): boolean => {
    // Accept only messages originating from this extension AND the fan-out
    // type (guards against other extensions and unrelated traffic).
    if (sender?.id !== chrome.runtime.id) return false;
    if (!isSessionLockRequestMessage(message)) return false;

    const apply = async (): Promise<void> => {
      try {
        await handleSessionLockRequest(message, deps);
        sendResponse({ success: true });
      } catch (error) {
        // A failed re-read answers the failure body so the sender's retry
        // contract (3 attempts / 2 waits / never-confirmed log) decides the
        // outcome, instead of the message port hanging open until unload.
        await logWarn(
          'Failed to re-read the session lock state for SESSION_LOCK_REQUEST',
          { error: errorMessage(error) },
          undefined,
          'sessionLockReceiver.ts'
        );
        sendResponse({ success: false });
      }
    };
    void apply();
    // Keep the message channel open: the response goes out after the lock
    // re-read settles (the return-true onMessage contract).
    return true;
  };

  chrome.runtime.onMessage.addListener(listener);

  return () => {
    chrome.runtime.onMessage.removeListener(listener);
  };
}
