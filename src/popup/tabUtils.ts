/**
 * tabUtils.ts
 * Utility for management of Chrome tabs in the popup UI.
 */

/**
 * Get the currently active tab in the current window.
 * @returns {Promise<chrome.tabs.Tab|null>}
 */
export async function getCurrentTab(): Promise<chrome.tabs.Tab | null> {
    if (!chrome.tabs) return null;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
}

/**
 * Check if the given tab is recordable (HTTP/HTTPS).
 * @param {chrome.tabs.Tab} tab 
 * @returns {boolean}
 */
export function isRecordable(tab: chrome.tabs.Tab | undefined | null): boolean {
    return !!(tab?.url && tab.url.startsWith('http'));
}
