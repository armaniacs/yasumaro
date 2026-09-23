/**
 * tabUtils.ts
 * Single seam for active-tab reads in the popup UI.
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

/**
 * Get the active tab domain via the shared extractor, or null when
 * there is no tab, no URL, or the URL is unparseable.
 */
export async function getActiveTabDomain(): Promise<string | null> {
    const url = await getActiveTabUrl();
    return getDomainForUrl(url);
}

/**
 * Get the active tab URL, throwing when absent.
 * Callers that must distinguish "no tab" from other failures use this
 * instead of branching on null themselves.
 */
export async function requireActiveTabUrl(): Promise<string> {
    const url = await getActiveTabUrl();
    if (!url) throw new Error('No active tab URL');
    return url;
}
