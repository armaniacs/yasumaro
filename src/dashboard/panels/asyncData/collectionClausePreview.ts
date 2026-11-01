import type { ClauseStorageQuery } from './collectionScopeResolver.js';

export interface ClauseCountSource {
  countForClause(query: ClauseStorageQuery): Promise<number>;
}

export interface ClausePreview {
  perRow: number[];
  total: number;
}

function isEmptyQuery(query: ClauseStorageQuery): boolean {
  return query.text === undefined && query.tagFilter === undefined && query.dateFrom === undefined && query.dateTo === undefined;
}

// Preview-only approximation of the merged clause total.
// OR uses the sum as an upper bound (overlaps are double-counted) and AND
// uses the minimum as an upper bound; neither is the exact union/intersection
// size. Exact resolution is the responsibility of `mergeClauseResults`
// (wired in at Panel time), and help copy must state that the total is approximate.
export async function previewClauseCounts(
  queries: ClauseStorageQuery[],
  op: 'and' | 'or',
  source: ClauseCountSource,
): Promise<ClausePreview> {
  const perRow: number[] = [];
  for (const query of queries) {
    if (isEmptyQuery(query)) {
      perRow.push(0);
      continue;
    }
    perRow.push(await source.countForClause(query));
  }
  if (perRow.every((n) => n === 0)) return { perRow, total: 0 };
  if (op === 'or') return { perRow, total: perRow.reduce((a, b) => a + b, 0) };
  return { perRow, total: Math.min(...perRow) };
}
