// @layer 0
/**
 * listSources.ts (PBI 2026-09-11-05, round 6) — single source for every
 * filter-list / metadata source host the extension may talk to.
 *
 * Previously the same five hosts were re-declared in four tables
 * (urlWhitelist gate, buildAllowedUrls origins, cspDomains optional
 * permissions, cspValidator optional domains) with no cross-check — adding a
 * source to one table silently left the others behind (nsfw.oisd.nl's
 * gate/grant mismatch). Consumers derive from FILTER_LIST_SOURCES here and
 * the conformance test (list-sources-conformance.test.ts) pins set equality.
 */

/** A filter-list source the user can register (uBlock / CSV lists). */
export interface FilterListSource {
  /** Bare hostname (whitelist gate + CSP host set). */
  host: string;
  /** Canonical fetch origin (allowed-urls set). */
  origin: string;
}

/** Filter-list sources the extension may fetch from. */
export const FILTER_LIST_SOURCES: readonly FilterListSource[] = [
  { host: 'raw.githubusercontent.com', origin: 'https://raw.githubusercontent.com' },
  { host: 'gitlab.com', origin: 'https://gitlab.com' },
  { host: 'easylist.to', origin: 'https://easylist.to' },
  { host: 'pgl.yoyo.org', origin: 'https://pgl.yoyo.org' },
  { host: 'nsfw.oisd.nl', origin: 'https://nsfw.oisd.nl' },
] as const;

/**
 * Tranco top-sites download (trust DB updater). NOT a filter list — the
 * updater calls fetchWithTimeout directly (CSP-gated, never FETCH_URL), so
 * it only needs the CSP/manifest permission. Documented separately to keep
 * the two concerns from being conflated in the allow lists.
 */
export const TRANCO_METADATA_SOURCE: FilterListSource = {
  host: 'tranco-list.eu',
  origin: 'https://tranco-list.eu',
};

export const ALL_LIST_SOURCES: readonly FilterListSource[] = [
  ...FILTER_LIST_SOURCES,
  TRANCO_METADATA_SOURCE,
] as const;
