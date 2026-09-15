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
  url?: string | undefined;
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

// ============================================================================
// SQLite sender authorization (SSOT — PBI 2026-09-15-02)
// ============================================================================
// The "content scripts may not send SQLITE_*" policy used to be spelled twice
// (senderTrust.ts local redefinition + offscreen.ts inline checks), and the
// Firefox in-page transport fabricated a sender to pass it. Both paths now
// delegate to this module: one authorization function, one opaque proof type.

/** Opaque marker produced only by authorizeSqliteSender after both checks
 *  (content-script rejection + runtime id match) have passed. Consumers that
 *  require an authorized sender cannot reach the dispatch without this proof —
 *  enforced by the type checker, not by convention. */
export type AuthorizedSqliteSender = { readonly __brand: 'AuthorizedSqliteSender' };

export type SqliteSenderAuthorization =
  | { ok: true; proof: AuthorizedSqliteSender }
  | { ok: false; reason: 'content-script' | 'external-extension' };

/**
 * Authorize a sender for SQLITE_* message dispatch.
 * @param sender Message sender (real or the in-page transport's own context).
 * @param runtimeId chrome.runtime.id of this extension.
 */
export function authorizeSqliteSender(sender: SenderLike & { id?: string }, runtimeId: string | undefined): SqliteSenderAuthorization {
  if (isContentScriptSender(sender)) {
    return { ok: false, reason: 'content-script' };
  }
  // runtimeId が undefined（テスト環境など）でも常に比較する — 無条件許可は
  // 恒真式になり sender ゲートが空洞化する（offscreen-security テストが pin）。
  if (sender.id !== runtimeId) {
    return { ok: false, reason: 'external-extension' };
  }
  return { ok: true, proof: { __brand: 'AuthorizedSqliteSender' } };
}
