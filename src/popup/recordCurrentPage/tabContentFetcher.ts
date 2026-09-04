import { getMessage } from '../../utils/i18n.js';
import type { ContentResponse } from '../mainTypes.js';
import { showSpinner } from '../spinner.js';
import { getPermissionManager } from '../../utils/permissionManager.js';
import { StorageKeys } from '../../utils/storage/types.js';

/**
 * コンテンツスクリプトからページ内容を取得する。
 * パーミッション不足時は権限ラダーでフォールバック:
 *  Level1: per-origin (PermissionManager.requestPermission)
 *  Level2: allowAllUrlsOptIn のときのみ <all_urls>
 */
export class TabContentFetcher {

  /**
   * @returns 取得されたコンテンツレスポンス
   * @throws 取得不能な場合はエラー
   */
  async fetch(tab: chrome.tabs.Tab, force: boolean): Promise<ContentResponse> {
    if (!tab.id) throw new Error('No active tab found');

    showSpinner(getMessage('fetchingContent'));

    try {
      const contentResponse = await Promise.race([
        chrome.tabs.sendMessage(tab.id, { type: 'GET_CONTENT' }) as Promise<ContentResponse>,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Content script response timeout')), 5000);
        })
      ]);
      if (chrome.runtime.lastError) {
        throw new Error(chrome.runtime.lastError.message);
      }
      return contentResponse;
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
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => document.body?.innerText || ''
          });
          return { content: results?.[0]?.result || '' };
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
            const results = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => document.body?.innerText || ''
            });
            return { content: results?.[0]?.result || '' };
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
