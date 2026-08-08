/**
 * Who is allowed to send a given message type.
 *
 * The registry's own gate only checks `sender.id === chrome.runtime.id`, which
 * content scripts satisfy — they run inside a web page but are still part of
 * this extension. Privileged handlers therefore each grew their own guard, in
 * four different spellings, and four message types ended up with no guard at
 * all. Stating the level at registration keeps the policy in one place and
 * makes "content scripts may call this" a deliberate choice rather than the
 * silent default.
 */
export type SenderTrustLevel =
  /**
   * Extension pages and the offscreen document only (popup, dashboard,
   * options, offscreen). Anything running in a web page is rejected.
   */
  | 'extension-only'
  /**
   * Content scripts are expected callers, alongside extension pages. Use only
   * where a web page's tab is the legitimate source of the message.
   */
  | 'content-script-allowed';

export interface SenderTrustDecision {
  allowed: boolean;
  /** Populated when `allowed` is false. */
  error?: string;
}

/**
 * A content script's sender has a `tab` and a page URL (http/https). Extension
 * pages and the offscreen document either have no tab or carry a
 * `chrome-extension://` URL.
 */
function isContentScriptSender(sender: chrome.runtime.MessageSender): boolean {
  return Boolean(sender.tab) && (!sender.url || !sender.url.startsWith('chrome-extension://'));
}

/**
 * Decides whether `sender` may invoke a handler registered at `level`.
 *
 * Mirrors the checks that previously lived in each handler, so tightening or
 * loosening a message type is now a one-line change at its registration.
 */
export function checkSenderTrust(
  sender: chrome.runtime.MessageSender,
  level: SenderTrustLevel,
  messageType: string,
  runtimeId: string | undefined = typeof chrome !== 'undefined' ? chrome.runtime?.id : undefined,
): SenderTrustDecision {
  if (runtimeId !== undefined && sender.id !== runtimeId) {
    return { allowed: false, error: `${messageType} is not allowed from external extensions` };
  }

  if (level === 'extension-only' && isContentScriptSender(sender)) {
    return { allowed: false, error: `${messageType} is not allowed from content scripts` };
  }

  return { allowed: true };
}
