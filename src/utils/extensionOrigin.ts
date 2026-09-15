/**
 * extensionOrigin.ts — the extension's own origin for sender identification.
 *
 * Used to tell extension pages (popup, dashboard, options, offscreen) apart
 * from content scripts running in web pages. sender.tab alone is NOT a
 * reliable discriminator: Chrome only sets it for content scripts, but
 * Firefox also sets it for extension pages running in normal tabs (e.g. the
 * dashboard opened as moz-extension://<uuid>/options.html?tab=history).
 * Likewise, hardcoding the "chrome-extension://" scheme breaks on Firefox,
 * whose sender URLs use "moz-extension://<uuid>/...".
 *
 * The origin comes from chrome.runtime.getURL(''), which returns the
 * browser-appropriate scheme. Shared by the background sender trust gate
 * (src/background/handlers/senderTrust.ts) and the offscreen document's own
 * checks (src/offscreen/offscreen.ts).
 */

/** Minimal sender shape needed for origin identification. */
export interface SenderLike {
  tab?: unknown;
  url?: string;
}

/**
 * The extension origin with trailing slash (e.g. "chrome-extension://<id>/"
 * on Chromium, "moz-extension://<uuid>/" on Firefox). Falls back to the
 * Chromium scheme when chrome is unavailable (unit tests, non-extension
 * contexts).
 */
export function extensionOrigin(): string {
  try {
    const url = globalThis.chrome?.runtime?.getURL?.('');
    if (typeof url === 'string' && url.length > 0) {
      return url;
    }
  } catch {
    // fall through to the default below
  }
  return 'chrome-extension://';
}

/**
 * True when the sender is a content script: it runs in a tab on a URL outside
 * the extension origin (http/https pages). Extension pages share our origin
 * whether or not the browser attaches a tab to them.
 */
export function isContentScriptSender(sender: SenderLike): boolean {
  return Boolean(sender.tab) && (!sender.url || !sender.url.startsWith(extensionOrigin()));
}
