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
