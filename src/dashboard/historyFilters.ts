/**
 * historyFilters.ts — after the legacy panel-history removal (PBI 2026-09-11-09),
 * only the SQLite panel's tag-fallback decision remains. The filtered-entries
 * list, filter-type matcher and tag indicator were legacy-panel UI helpers and
 * are gone with it.
 */

/**
 * Decide whether the SQLite History panel should fall back from a tag-based
 * filter to a full-text search when the tag filter produced no rows.
 *
 * Returns `null` when no fallback is desired (tag filter has hits, or the
 * request did not originate from a tag). Returns the trimmed search term
 * otherwise.
 *
 * Trigger conditions (all must hold):
 *  - `source` is 'tag' (i.e. navigation came from Tag Cluster, not manual search)
 *  - `tagRows` has zero total matches
 *  - `rawTagFilter` (without a leading '#') is non-empty after trimming
 */
export function shouldFallbackToTextSearch(
  source: 'tag' | 'manual',
  tagRows: { rows: unknown[]; total: number } | null,
  rawTagFilter: string | null,
): string | null {
  if (source !== 'tag') return null;
  if (rawTagFilter == null) return null;
  const trimmed = rawTagFilter.trim().replace(/^#/, '').trim();
  if (!trimmed) return null;
  if (tagRows && tagRows.total > 0) return null;
  return trimmed;
}
