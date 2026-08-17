import { getMessage } from '../../utils/i18n.js';
import type { ContentResponse } from '../mainTypes.js';
import { SpinnerManager } from './spinnerManager.js';

/**
 * コンテンツスクリプトからページ内容を取得する。
 * パーミッション不足時はスクリプティングAPIでフォールバック。
 */
export class TabContentFetcher {
  constructor(private readonly spinner: SpinnerManager = new SpinnerManager()) {}

  /**
   * @returns 取得されたコンテンツレスポンス
   * @throws 取得不能な場合はエラー
   */
  async fetch(tab: chrome.tabs.Tab, force: boolean): Promise<ContentResponse> {
    if (!tab.id) throw new Error('No active tab found');

    this.spinner.show(getMessage('fetchingContent'));

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
      let hasPermission = false;
      try {
        hasPermission = await chrome.permissions.contains({ origins: ['<all_urls>'] });
        if (!hasPermission) {
          hasPermission = await chrome.permissions.request({ origins: ['<all_urls>'] });
        }
      } catch { /* パーミッション要求失敗 */ }

      if (!hasPermission) {
        throw new Error(getMessage('errorContentScriptNotAvailable'));
      }

      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => document.body?.innerText || ''
        });
        return { content: results?.[0]?.result || '' };
      } catch (_e2: unknown) {
        if (force) {
          return { content: '' };
        }
        throw new Error(getMessage('errorContentScriptNotAvailable'));
      }
    }
  }
}
