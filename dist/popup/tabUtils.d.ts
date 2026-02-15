/**
 * tabUtils.ts
 * Utility for management of Chrome tabs in the popup UI.
 */
/**
 * Get the currently active tab in the current window.
 * @returns {Promise<chrome.tabs.Tab|null>}
 */
export declare function getCurrentTab(): Promise<chrome.tabs.Tab | null>;
/**
 * Check if the given tab is recordable (HTTP/HTTPS).
 * @param {chrome.tabs.Tab} tab
 * @returns {boolean}
 */
export declare function isRecordable(tab: chrome.tabs.Tab | undefined | null): boolean;
//# sourceMappingURL=tabUtils.d.ts.map