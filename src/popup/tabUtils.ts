/**
 * tabUtils.ts
 * Single seam for active-tab reads in the popup UI.
 *
 * This module is the one query module for the popup: exactly three methods
 * (getCurrentTab, getActiveTabUrl, getDomainForUrl). Degenerate handling
 * (no tab, no URL, unparseable URL) is owned here — callers must use these
 * methods instead of re-implementing null guards around chrome.tabs.query.
 * Snapshot lifecycle (load vs finish-path refetch) is owned by statusStore,
 * never by this module: every method here performs a fresh read.
 */

import { extractDomain } from '../utils/domainUtils.js';

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
 * Get the active tab URL, or null when there is no tab or no URL.
 */
export async function getActiveTabUrl(): Promise<string | null> {
    const tab = await getCurrentTab();
    return tab?.url ?? null;
}

/**
 * Normalize a URL to its domain via the shared extractor.
 * Returns null for missing or unparseable input (never throws).
 */
export function getDomainForUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    return extractDomain(url);
}
