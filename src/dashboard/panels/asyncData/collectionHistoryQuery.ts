/**
 * collectionHistoryQuery.ts
 * v2 collection execution for the history list (PBI 2026-11-02-07).
 *
 * The legacy v1 `applyCollection` path (sqliteHistoryModel) paints one flat
 * condition (search/tag/day) into the list. A v2 collection carries many
 * clauses plus pinned ids, so it needs its own execution:
 *
 *   1. parse via `parseCollectionQueryV2` (fail-closed to empty),
 *   2. resolve each clause to storage options (`resolveCollectionQueries`),
 *   3. fan out: one `queryHistory` call per clause (DI, defaults to real),
 *   4. merge per-clause id sets (`mergeClauseResults`) UNION the pinned ids,
 *   5. one pin-cover re-fetch for ids no clause returned (N+1 total),
 *      still-missing ids are deleted-missing and excluded, never an error,
 *   6. order by created_at, slice to MAX_COLLECTION_ROWS with a notice.
 *
 * Sorting is ALWAYS created_at-based. Rank is per-clause FTS5 output and
 * meaningless across clauses, so `relevance` is never applied here even when
 * a clause ran a text search — every fan-out call requests created_at order
 * explicitly (queryHistory would otherwise default text searches to rank).
 */
import { queryHistory, isServiceError } from './sqliteHistoryQuery.js';
import type { BrowsingLogEntry } from './sqliteHistoryQuery.js';
import { resolveCollectionQueries } from './collectionScopeResolver.js';
import { parseCollectionQueryV2, mergeClauseResults } from '../../../utils/collectionQueryV2.js';
import { MAX_COLLECTION_FANOUT, MAX_COLLECTION_ROWS } from '../../../utils/limits.js';
import { pickDefined } from '../../../utils/objectUtils.js';

/**
 * Warning payload for the history list. `null` means the collection applied
 * cleanly; otherwise the panel shows the notice next to the count.
 */
export interface CollectionWarning {
  /** True when clauses exceeded MAX_COLLECTION_FANOUT (first clause only ran). */
  fanoutCapped: boolean;
  /** Clauses the stored collection carried (before the fan-out cap). */
  totalClauses: number;
  /** True when the merged set exceeded MAX_COLLECTION_ROWS (head kept). */
  truncated: boolean;
  /** Rows kept for the list. */
  shownCount: number;
  /** Merged rows before truncation. */
  fullCount: number;
}

export interface CollectionHistoryResult {
  /** Merged rows, created_at-ordered, already sliced to MAX_COLLECTION_ROWS. */
  rows: BrowsingLogEntry[];
  /** Rows available for paging (== rows.length; drives the page control). */
  total: number;
  warning: CollectionWarning | null;
}

export type CollectionHistoryOutcome =
  | { data: CollectionHistoryResult }
  | { error: string };

/** Sort direction for the merged list; relevance is not a member on purpose. */
export type CollectionHistorySortDir = 'ASC' | 'DESC';

/** Created_at ordering for merged collection rows (id tie-break, stable). Exported so the model can re-sort the cached set when the sort direction changes without re-running the fan-out. */
export function orderCollectionRows(
  rows: BrowsingLogEntry[],
  dir: CollectionHistorySortDir,
): BrowsingLogEntry[] {
  const sorted = [...rows].sort((a, b) =>
    a.created_at === b.created_at ? a.id - b.id : a.created_at - b.created_at,
  );
  return dir === 'ASC' ? sorted : sorted.reverse();
}

/**
 * Execute a v2 collection against the history list.
 *
 * @param rawQuery the stored collection query (v2 or legacy flat shape —
 *   parseCollectionQueryV2 reads both, so a collapsed single-clause
 *   collection lands here too).
 * @param runQuery per-clause query seam (defaults to the real queryHistory;
 *   tests inject a fake — same DI shape as the model's runQueryHistory).
 */
export async function resolveCollectionHistory(
  rawQuery: unknown,
  runQuery: typeof queryHistory = queryHistory,
  opts: { sortDir?: CollectionHistorySortDir } = {},
): Promise<CollectionHistoryOutcome> {
  const sortDir = opts.sortDir ?? 'DESC';
  const parsed = parseCollectionQueryV2(rawQuery);
  if (parsed.clauses.length === 0 && parsed.ids.length === 0) {
    return { data: { rows: [], total: 0, warning: null } };
  }

  const fanoutCapped = parsed.clauses.length > MAX_COLLECTION_FANOUT;
  const effectiveClauses = fanoutCapped
    ? parsed.clauses.slice(0, 1)
    : parsed.clauses;
  const resolved = resolveCollectionQueries({
    ...parsed,
    clauses: effectiveClauses,
  });

  const rowById = new Map<number, BrowsingLogEntry>();
  const idSets: number[][] = [];
  for (const clause of resolved) {
    const result = await runQuery({
      limit: MAX_COLLECTION_ROWS,
      offset: 0,
      sortBy: 'created_at',
      sortDir,
      ...pickDefined({
        search: clause.text,
        tagFilter: clause.tagFilter,
        since: clause.dateFrom,
        until: clause.dateTo,
      }),
    });
    if (isServiceError(result)) {
      return { error: result.error };
    }
    const rows = result.data.rows;
    for (const row of rows) {
      if (!rowById.has(row.id)) rowById.set(row.id, row);
    }
    idSets.push(rows.map((row) => row.id));
  }

  // UNION semantics (report contract, PBI 2026-11-02-04): clause ids plus
  // pinned ids. Sort before slicing so truncation keeps the newest/oldest
  // head instead of an arbitrary clause order.
  const merged = mergeClauseResults(idSets, parsed.op);
  const wanted = [...new Set([...merged, ...parsed.ids])];

  // The +1 of N+1: pins (and ids outside a capped clause window) have no row
  // yet. One bounded plain-listing re-fetch covers them; there is no
  // ids-filtered query on the dashboard wire path (adding one would touch
  // offscreen), so anything still missing is treated as deleted-missing and
  // excluded — never an error.
  const missing = wanted.filter((id) => !rowById.has(id));
  if (missing.length > 0) {
    const cover = await runQuery({
      limit: MAX_COLLECTION_ROWS,
      offset: 0,
      sortBy: 'created_at',
      sortDir: 'DESC',
    });
    if (!isServiceError(cover)) {
      for (const row of cover.data.rows) {
        if (!rowById.has(row.id)) rowById.set(row.id, row);
      }
    }
  }

  const rows = orderCollectionRows(
    wanted.flatMap((id) => (rowById.has(id) ? [rowById.get(id)!] : [])),
    sortDir,
  );
  const fullCount = rows.length;
  const truncated = fullCount > MAX_COLLECTION_ROWS;
  const kept = truncated ? rows.slice(0, MAX_COLLECTION_ROWS) : rows;
  const warning: CollectionWarning | null =
    fanoutCapped || truncated
      ? {
          fanoutCapped,
          totalClauses: parsed.clauses.length,
          truncated,
          shownCount: kept.length,
          fullCount,
        }
      : null;
  return { data: { rows: kept, total: kept.length, warning } };
}
