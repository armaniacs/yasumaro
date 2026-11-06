/**
 * collectionQueryV2.ts
 *
 * Canonical condition-shape logic for named saved collections (V2).
 *
 * Hoisted from src/dashboard/panels/asyncData/savedCollectionQuery.ts
 * (PBI 2026-11-02-02): the background ask-history scope normalizer
 * (src/messaging/responseCanonical.ts) must resolve the same V2 shape the
 * panel saves, but neither messaging nor background may import from the
 * dashboard layer. This module is the single owner — the dashboard module
 * re-exports it, so the panel and the background cannot drift.
 *
 * Pure: no DOM, no chrome, no storage — unit-testable as-is.
 *
 * 縮退の出口: an unknown stored shape fails closed to the empty condition, so
 * a corrupted query degrades to "no conditions" instead of poisoning recall.
 */

import { MAX_QUERY_IDS, MAX_SEARCH_QUERY_LENGTH } from './limits.js';

export interface CollectionClause {
  search: string;
  tag: string | null;
  date: string | null;
}

export interface CollectionQueryV2 {
  version: 2;
  op: 'and' | 'or';
  clauses: CollectionClause[];
  ids: number[];
}

function readClause(raw: unknown): CollectionClause | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
  // S-#4: per-field string ceiling. Clause text feeds the same FTS/LIKE
  // machinery the DASHBOARD_SQLITE search row caps at
  // MAX_SEARCH_QUERY_LENGTH, but a stored clause crosses no wire gate — so
  // the normalizer truncates instead of rejecting. Truncation keeps the
  // clause enforceable (dropping it would widen an AND), and legitimate
  // inputs sit orders of magnitude below the cap.
  const cap = (v: string): string =>
    v.length > MAX_SEARCH_QUERY_LENGTH ? v.slice(0, MAX_SEARCH_QUERY_LENGTH) : v;
  const search = cap(str(r['search']) ?? '');
  const tagRaw = str(r['tag']);
  const tag = tagRaw === null ? null : cap(tagRaw);
  const dateRaw = str(r['date']);
  const date = dateRaw === null ? null : cap(dateRaw);
  if (search === '' && tag === null && date === null) return null;
  return { search, tag, date };
}

export function parseCollectionQueryV2(raw: unknown): CollectionQueryV2 {
  if (typeof raw !== 'object' || raw === null) return { version: 2, op: 'and', clauses: [], ids: [] };
  const r = raw as Record<string, unknown>;
  const ids = Array.isArray(r['ids'])
    ? (r['ids'] as unknown[])
        .filter((v): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0)
        .slice(0, MAX_QUERY_IDS)
    : [];
  if (Array.isArray(r['clauses'])) {
    const clauses = (r['clauses'] as unknown[]).flatMap((c) => {
      const clause = readClause(c);
      return clause === null ? [] : [clause];
    });
    const op = r['op'] === 'or' ? 'or' : 'and';
    return { version: 2, op, clauses, ids };
  }
  const single = readClause(r);
  return { version: 2, op: 'and', clauses: single === null ? [] : [single], ids };
}

/**
 * Merge per-clause id sets by the collection combinator (PBI 2026-11-02-04
 * UNION semantics for the research report): 'or' unions, 'and'
 * intersects. Single owner — the dashboard resolver re-exports this, and
 * the background report generator imports it from here, so background never
 * imports from the dashboard layer.
 */
export function mergeClauseResults(idSets: number[][], op: 'and' | 'or'): number[] {
  if (idSets.length === 0) return [];
  if (op === 'or') {
    return [...new Set(idSets.flat())].sort((a, b) => a - b);
  }
  const first = new Set(idSets[0]);
  for (const s of idSets.slice(1)) {
    const rest = new Set(s);
    for (const id of [...first]) {
      if (!rest.has(id)) first.delete(id);
    }
  }
  return [...first].sort((a, b) => a - b);
}
