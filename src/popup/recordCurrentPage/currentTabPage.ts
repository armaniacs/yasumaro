/**
 * currentTabPage.ts
 * Popup page-info seam for the active tab (PBI 24 SRP split): tab
 * acquisition, favicon/title/URL rendering with fallbacks, and the
 * recordability check. Button state stays in RecordSession (sole button
 * writer contract).
 */

import { getCurrentTab } from '../tabUtils.js';
import { isRecordableTab } from '../../utils/recordingGateTable.js';
import { getMessage } from '../../utils/i18n.js';

/**
 * Fetch the active tab. Null means the caller exits early (no tab).
 * @returns {Promise<chrome.tabs.Tab|null>}
 */
export async function fetchCurrentTab(): Promise<chrome.tabs.Tab | null> {
    const tab = await getCurrentTab();
    return tab || null;
}

/**
 * Render the favicon, title, and URL of the active tab into the popup.
 * Missing elements are ignored (degenerate popup DOM), and the fallbacks
 * stay exactly as before: title falls back to the noTitle message and the
 * URL is truncated at 50 characters with an ellipsis.
 */
export function renderCurrentTabPage(tab: chrome.tabs.Tab): void {
    const faviconUrl = new URL(chrome.runtime.getURL('/_favicon/'));
    if (tab.url) {
        faviconUrl.searchParams.set('pageUrl', tab.url);
    }
    faviconUrl.searchParams.set('size', '32');
    const faviconEl = document.getElementById('favicon') as HTMLImageElement;
    if (faviconEl) {
        faviconEl.src = faviconUrl.toString();
    }

    const pageTitleEl = document.getElementById('pageTitle');
    if (pageTitleEl) {
        pageTitleEl.textContent = tab.title || getMessage('noTitle');
    }
    const url = tab.url || '';
    const pageUrlEl = document.getElementById('pageUrl');
    if (pageUrlEl) {
        pageUrlEl.textContent = url.length > 50 ? url.substring(0, 50) + '...' : url;
    }
}

/**
 * Recordability validation for the active tab. Reads through the shared
 * gate-table seam (PBI 2026-09-23-05) so tests and the popup drive the same
 * table.
 */
export function isTabRecordable(tab: chrome.tabs.Tab): boolean {
    return isRecordableTab(tab);
}
