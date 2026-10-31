import { getMessage } from '../utils/i18n.js';
import type { ContentResponse, SelectionResponse } from './mainTypes.js';
import { getPermissionManager } from '../utils/permissionManager.js';
import { StorageKeys } from '../utils/storage/types.js';

/**
 * ContentFetchGateway (PBI 2026-09-11-04) — the single seam for "popup asks a
 * tab for content". Previously three spellings coexisted: TabContentFetcher
 * (timeout + permission ladder, record flow) and two raw callback
 * `chrome.tabs.sendMessage` copies in statusPanel.ts (no timeout, dead
 * `chrome.runtime.lastError` polls).
 *
 * Two entry points, one policy:
 * - `requestContentFromTab` — passive ask, no permission prompts. Returns null
 *   on failure/timeout so status displays degrade silently.
 * - `ContentFetchGateway.fetch` — record-flow fetch with the permission ladder
 *   (per-origin → opted-in <all_urls>) and spinner.
 */

export const CONTENT_FETCH_TIMEOUT_MS = 5000;

/** Injectable transport for tests: how one message reaches a tab. */
export type TabSendTransport = (
  tabId: number,
  message: unknown,
) => Promise<unknown>;

const defaultTabTransport: TabSendTransport = (tabId, message) =>
  chrome.tabs.sendMessage(tabId, message) as Promise<unknown>;

/**
 * Ask a tab's content script for page content. Resolves null when the content
 * script does not answer within the timeout (or the send rejects) — callers
 * decide whether that is fatal. Never prompts for permissions.
 */
export async function requestContentFromTab(
  tabId: number,
  opts?: { timeoutMs?: number; transport?: TabSendTransport },
): Promise<ContentResponse | null> {
  const timeoutMs = opts?.timeoutMs ?? CONTENT_FETCH_TIMEOUT_MS;
  const send = opts?.transport ?? defaultTabTransport;
  try {
    return await Promise.race([
      send(tabId, { type: 'GET_CONTENT' }) as Promise<ContentResponse>,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]) ?? null;
  } catch {
    // Promise-style sendMessage rejects on failure (callback-era
    // chrome.runtime.lastError is never set on this path).
    return null;
  }
}

/**
 * Ask a tab's content script for the current selection (PBI 2026-10-31-03).
 * Same passive null contract as requestContentFromTab — no permission
 * prompts, no ladder. A content script that does not answer (or does not
 * exist) resolves null, and the caller falls back to the page record exactly
 * as before. The raw selection travels verbatim; normalization + the
 * 10,000-char cap are the consumer's job (utils/selectionText.js), so the
 * same helper serves both capture paths.
 */
export async function requestSelectionFromTab(
  tabId: number,
  opts?: { timeoutMs?: number; transport?: TabSendTransport },
): Promise<SelectionResponse | null> {
  const timeoutMs = opts?.timeoutMs ?? CONTENT_FETCH_TIMEOUT_MS;
  const send = opts?.transport ?? defaultTabTransport;
  try {
    return await Promise.race([
      send(tabId, { type: 'GET_SELECTION' }) as Promise<SelectionResponse>,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]) ?? null;
  } catch {
    // Same rejection shape as requestContentFromTab — a content script that
    // is not injected rejects instead of answering.
    return null;
  }
}

/** Last-resort extraction shared by both ladder levels (PBI 2026-09-11-04:
 * the two verbatim executeScript bodies collapsed into one adapter). */
async function executeScriptInnerText(tabId: number): Promise<ContentResponse> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => document.body?.innerText || ''
  });
  return { content: results?.[0]?.result || '' };
}

/**
 * Record-flow fetch: timeout ask first, then the permission ladder
 * (Level 1 per-origin via PermissionManager, Level 2 <all_urls> only when
 * opted-in via settings), then executeScript extraction as the last resort.
 * Spinner ownership belongs to the callers (show/hide pairs live with the
 * flow that owns the whole operation).
 */
export class ContentFetchGateway {

  /**
   * @returns 取得されたコンテンツレスポンス
   * @throws 取得不能な場合はエラー
   */
  async fetch(tab: chrome.tabs.Tab, force: boolean): Promise<ContentResponse> {
    if (!tab.id) throw new Error('No active tab found');

    try {
      const contentResponse = await requestContentFromTab(tab.id);
      if (contentResponse) return contentResponse;
      throw new Error('Content script response timeout');
    } catch (_e: unknown) {
      const pm = getPermissionManager();

      // Level 1: per-origin via PermissionManager (narrowest)
      let hasPerOrigin = false;
      const tabUrl = tab.url ?? '';
      if (tabUrl) {
        try {
          hasPerOrigin = await pm.isHostPermitted(tabUrl);
          if (!hasPerOrigin) {
            hasPerOrigin = await pm.requestPermission(tabUrl);
          }
        } catch { /* permission check/request failure */ }
      }

      if (hasPerOrigin) {
        try {
          return await executeScriptInnerText(tab.id);
        } catch (_e2: unknown) {
          if (force) return { content: '' };
          throw new Error(getMessage('errorContentScriptNotAvailable'));
        }
      }

      // Level 2: <all_urls> only when explicitly opted-in via settings.
      // Reader-only by design: nothing writes ALLOW_ALL_URLS_OPT_IN at runtime
      // (DEFAULT_SETTINGS is the only source), so this flag stays false unless
      // the profile explicitly carries it. The banner path (trustPanel) does
      // not consult this flag either — it calls requestAllUrls directly — so
      // the record flow (gated) and the banner flow (ungated) are intentionally
      // asymmetric, and adding a writer here was rejected: it would gate a flow
      // that is meant to stay one-click. The legacy 'allowAllUrlsOptIn'
      // raw-literal fallback was removed: the StorageKeys constant is the only
      // name this reader accepts, and a second spelling is exactly the drift
      // the gateway collapsed. The key is on the migration allowlist
      // (TOP_LEVEL_ONLY_KEYS), so a settings migration re-run no longer deletes
      // it and the reader no longer degrades to permanently false.
      let allowAllUrlsOptIn = false;
      try {
        const stored = await chrome.storage.local.get(StorageKeys.ALLOW_ALL_URLS_OPT_IN) as Record<string, boolean | undefined>;
        allowAllUrlsOptIn = !!stored[StorageKeys.ALLOW_ALL_URLS_OPT_IN];
      } catch { /* storage unavailable */ }

      if (allowAllUrlsOptIn) {
        let hasAllUrls = false;
        try {
          hasAllUrls = await pm.isAllUrlsPermitted();
          if (!hasAllUrls) {
            hasAllUrls = await pm.requestAllUrls();
          }
        } catch { /* permission failure */ }
        if (hasAllUrls) {
          try {
            return await executeScriptInnerText(tab.id);
          } catch (_e3: unknown) {
            if (force) return { content: '' };
            throw new Error(getMessage('errorContentScriptNotAvailable'));
          }
        }
      }

      throw new Error(getMessage('errorContentScriptNotAvailable'));
    }
  }
}
