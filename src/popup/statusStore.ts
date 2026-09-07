/**
 * statusStore.ts
 * Single seam for "what is the active tab's recording status" in the popup.
 *
 * Owns the chrome.tabs.query + checkPageStatus pair so the status panel and
 * the record button answer the same question through one owner instead of
 * each re-implementing the fetch. Deliberately stateless: finish paths call
 * again for a fresh look (refresh semantics preserved) — the seam is about
 * one owner for the fetch logic, not about caching.
 */

import { checkPageStatus, StatusInfo } from './statusChecker.js';

export interface ActiveTabStatusSnapshot {
  tab: chrome.tabs.Tab | null;
  url: string | null;
  status: StatusInfo | null;
}

/** Single owner of the active-tab status fetch (popup open + finish paths). */
export async function loadActiveTabStatus(): Promise<ActiveTabStatusSnapshot> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0] ?? null;
  const url = tab?.url ?? null;
  const status = url ? await checkPageStatus(url) : null;
  return { tab, url, status };
}
