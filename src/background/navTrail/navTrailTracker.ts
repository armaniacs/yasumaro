/**
 * navTrailTracker.ts
 * Per-tab "where did this page come from" tracking for the opt-in navigation
 * trail (PBI 2026-09-26-03).
 *
 * The trail is reconstructed from tab activity alone: the previous URL in the
 * same tab is the referrer, and a referrer that looks like a search engine
 * carries the search term. Nothing is captured while the feature is off, and
 * turning it off drops the whole map rather than just the next write.
 *
 * WHY `chrome.storage.session` and not a module variable: the MV3 service
 * worker is torn down whenever it goes idle, so an in-memory map would forget
 * the previous page exactly when the worker happened to restart between two
 * navigations. Session storage is cleared by the browser when the profile
 * closes, which is also the right lifetime for "which tab was I on".
 *
 * WHY a Mutex: three listeners (updated / removed / consent watcher) all
 * read-modify-write the same map, and an interleaved pair can drop a tab's
 * entry or resurrect a removed one.
 */

import { Mutex } from '../../utils/Mutex.js';
import { normalizeNavUrl } from '../../utils/navUrl.js';
import { extractSearchQuery } from '../../utils/searchQuery.js';
import { sanitizeRegex } from '../../utils/piiSanitizer.js';
import { isDomainAllowed } from '../../utils/domainUtils.js';

import {
  getNavTrailConsent,
  isNavTrailActive,
} from '../../utils/storage/navTrailConsent.js';

export const NAV_TRAIL_SESSION_KEY = 'nav_trail_tabs';

export interface TabNavState {
  // WHY `| undefined` and not a bare `?`: with exactOptionalPropertyTypes, a
  // first visit writes `previous: undefined` explicitly, which a bare
  // optional property would reject.
  previous?: string | undefined;
  current?: string | undefined;
}

type TabNavMap = Record<string, TabNavState>;

export interface NavTrailFields {
  navSourceUrl?: string;
  searchQuery?: string;
}

const mutex = new Mutex();

async function readMap(): Promise<TabNavMap> {
  try {
    const result = await chrome.storage.session.get(NAV_TRAIL_SESSION_KEY);
    const stored = result[NAV_TRAIL_SESSION_KEY];
    if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
      return {};
    }
    return stored as TabNavMap;
  } catch {
    return {};
  }
}

async function writeMap(map: TabNavMap): Promise<void> {
  await chrome.storage.session.set({ [NAV_TRAIL_SESSION_KEY]: map });
}

export async function onTabUrlChanged(tabId: number, url: string): Promise<void> {
  if (!isNavTrailActive(await getNavTrailConsent())) {
    return;
  }
  const next = normalizeNavUrl(url);
  if (next === null) {
    return;
  }

  await mutex.acquire();
  try {
    const map = await readMap();
    const key = String(tabId);
    const state = map[key] ?? {};
    // A reload or a fragment-only change leaves `current` unchanged, so it
    // must not become the referrer of the next navigation.
    if (state.current === next) {
      return;
    }
    map[key] = { previous: state.current, current: next };
    await writeMap(map);
  } finally {
    mutex.release();
  }
}

export async function onTabRemoved(tabId: number): Promise<void> {
  await mutex.acquire();
  try {
    const map = await readMap();
    const key = String(tabId);
    if (!(key in map)) {
      return;
    }
    delete map[key];
    await writeMap(map);
  } finally {
    mutex.release();
  }
}

/**
 * The referrer for `pageUrl` in `tabId`, or null when the page is not the tab's
 * current one (the record raced the navigation) or the tab is unknown.
 * Read-only, so it takes no lock.
 */
export async function getNavSource(tabId: number, pageUrl: string): Promise<string | null> {
  const current = normalizeNavUrl(pageUrl);
  if (current === null) {
    return null;
  }
  const map = await readMap();
  const state = map[String(tabId)];
  if (!state || state.current !== current) {
    return null;
  }
  return state.previous ?? null;
}

export async function resolveNavTrailFields(
  tabId: number,
  pageUrl: string,
): Promise<NavTrailFields> {
  if (!isNavTrailActive(await getNavTrailConsent())) {
    return {};
  }
  const source = await getNavSource(tabId, pageUrl);
  if (source === null) {
    return {};
  }

  const fields: NavTrailFields = {};
  // WHY an excluded domain collapses to its origin: the user already said that
  // site's history is not ours to keep, so the full referrer path would
  // reintroduce exactly what the exclusion removed.
  if (await isDomainAllowed(source)) {
    fields.navSourceUrl = source;
  } else {
    fields.navSourceUrl = new URL(source).origin;
  }

  const query = extractSearchQuery(source);
  if (query !== null) {
    const masked = (await sanitizeRegex(query)).text;
    if (masked.length > 0) {
      fields.searchQuery = masked;
    }
  }

  return fields;
}

export async function clearAllNavTrail(): Promise<void> {
  await mutex.acquire();
  try {
    await chrome.storage.session.remove(NAV_TRAIL_SESSION_KEY);
  } finally {
    mutex.release();
  }
}

/**
 * Drop the tracked tabs as soon as consent is revoked, instead of waiting for
 * the next navigation. Registered once at service-worker top level, because MV3
 * discards listeners when the worker stops.
 */
export function registerNavTrailConsentWatcher(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') {
      return;
    }
    const change = changes['nav_trail_consent'];
    if (!change) {
      return;
    }
    const next = change.newValue;
    const active =
      typeof next === 'object' &&
      next !== null &&
      (next as { enabled?: unknown }).enabled === true &&
      (next as { consentedAt?: unknown }).consentedAt !== null &&
      typeof (next as { consentedAt?: unknown }).consentedAt === 'number';
    if (!active) {
      void clearAllNavTrail();
    }
  });
}
