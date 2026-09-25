/**
 * searchQuery.ts
 * Search-term extraction from a referrer URL, for the opt-in navigation trail
 * (PBI 2026-09-26-03).
 *
 * WHY a rule table rather than a generic `?q=` sniff: a query parameter named
 * `q` is not a search term on every site — plenty of hosts use it for a page
 * id, a filter, or a session token. Only hosts we can name are treated as
 * search engines, so an unrecognized referrer contributes no `search_query` at
 * all rather than a wrong one.
 *
 * WHY the length cap counts code points: `slice` on UTF-16 code units can cut a
 * surrogate pair in half and store a lone surrogate, which SQLite will keep and
 * the dashboard will then have to render.
 */

export interface SearchEngineRule {
  readonly host: RegExp;
  readonly param: string;
}

export const SEARCH_ENGINE_RULES: readonly SearchEngineRule[] = [
  { host: /(^|\.)google\.[a-z.]+$/, param: 'q' },
  { host: /(^|\.)bing\.com$/, param: 'q' },
  { host: /(^|\.)duckduckgo\.com$/, param: 'q' },
  { host: /^search\.yahoo\.com$/, param: 'p' },
  { host: /^search\.yahoo\.co\.jp$/, param: 'p' },
  { host: /^search\.brave\.com$/, param: 'q' },
  { host: /(^|\.)ecosia\.org$/, param: 'q' },
];

export const MAX_SEARCH_QUERY_CHARS = 200;

export function extractSearchQuery(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const rule = SEARCH_ENGINE_RULES.find((candidate) => candidate.host.test(host));
  if (!rule) {
    return null;
  }

  // URLSearchParams decodes %20 and + for us.
  const raw = parsed.searchParams.get(rule.param);
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return Array.from(trimmed).slice(0, MAX_SEARCH_QUERY_CHARS).join('');
}
