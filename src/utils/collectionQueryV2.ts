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
  const search = str(r['search']) ?? '';
  const tag = str(r['tag']);
  const date = str(r['date']);
  if (search === '' && tag === null && date === null) return null;
  return { search, tag, date };
}

export function parseCollectionQueryV2(raw: unknown): CollectionQueryV2 {
  if (typeof raw !== 'object' || raw === null) return { version: 2, op: 'and', clauses: [], ids: [] };
  const r = raw as Record<string, unknown>;
  const ids = Array.isArray(r['ids'])
    ? (r['ids'] as unknown[]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
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
    for (const id of [...first]) {
      if (!s.includes(id)) first.delete(id);
    }
  }
  return [...first].sort((a, b) => a - b);
}
