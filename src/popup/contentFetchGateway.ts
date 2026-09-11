import { getMessage } from '../utils/i18n.js';
import type { ContentResponse } from './mainTypes.js';
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

      // Level 2: <all_urls> only when explicitly opted-in via settings
      let allowAllUrlsOptIn = false;
      try {
        const stored = await chrome.storage.local.get(StorageKeys.ALLOW_ALL_URLS_OPT_IN) as Record<string, boolean | undefined>;
        allowAllUrlsOptIn = !!stored[StorageKeys.ALLOW_ALL_URLS_OPT_IN];
        if (!allowAllUrlsOptIn) {
          // fallback to legacy raw key used by older code/tests
          const legacy = await chrome.storage.local.get('allowAllUrlsOptIn') as Record<string, boolean | undefined>;
          allowAllUrlsOptIn = !!legacy['allowAllUrlsOptIn'];
        }
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
