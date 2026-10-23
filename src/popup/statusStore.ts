/**
 * statusStore.ts
 * Single owner of "what is the active tab's recording status" in the popup,
 * including the refetch policy.
 *
 * Owns the active-tab status fetch (tabUtils seam + checkPageStatus pair) so the status panel and
 * the record button answer the same question through one owner instead of
 * each re-implementing the fetch. Deliberately stateless: finish paths call
 * again for a fresh look (refresh semantics preserved) — the seam is about
 * one owner for the fetch logic, not about caching.
 *
 * Refetch policy (fresh-look semantics): the open path loads once via
 * loadActiveTabStatus; every finish path (cancel, finish-to-idle, the
 * result-timer reset, the CANCELLED branch) refetches via
 * refreshActiveTabStatus and never reuses a stored snapshot. The
 * snapshot-or-refresh choice itself lives in resolveActiveTabStatus so the
 * `snapshot ?? fresh load` rule has one owner instead of one copy per
 * caller.
 */

import { checkPageStatus, StatusInfo } from './statusChecker.js';
import { getCurrentTab } from './tabUtils.js';

export interface ActiveTabStatusSnapshot {
  tab: chrome.tabs.Tab | null;
  url: string | null;
  status: StatusInfo | null;
}

/**
 * Shared loader: one chrome.tabs.query per call, degenerate rule in one
 * place (null tab -> null url -> null status, no checkPageStatus call).
 */
async function fetchSnapshot(): Promise<ActiveTabStatusSnapshot> {
  const tab = await getCurrentTab();
  const url = tab?.url ?? null;
  const status = url ? await checkPageStatus(url) : null;
  return { tab, url, status };
}

/** Single owner of the active-tab status fetch (popup open path). */
export async function loadActiveTabStatus(): Promise<ActiveTabStatusSnapshot> {
  return fetchSnapshot();
}

/**
 * Finish-path fresh look: always re-queries, never serves a cached
 * snapshot. Finish paths must call this instead of reusing a snapshot
 * taken before the record attempt.
 */
export async function refreshActiveTabStatus(): Promise<ActiveTabStatusSnapshot> {
  return fetchSnapshot();
}

/**
 * Snapshot-or-refresh policy: use the given snapshot when present,
 * otherwise take a fresh look. Embodies the `snapshot ?? fresh load` rule
 * so callers share one policy instead of each spelling it out.
 */
export async function resolveActiveTabStatus(
  snapshot?: ActiveTabStatusSnapshot | null,
): Promise<ActiveTabStatusSnapshot> {
  if (snapshot) return snapshot;
  return fetchSnapshot();
}
