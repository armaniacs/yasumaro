/**
 * tagCooccurrenceTable.ts
 * Pure ranking of tag co-occurrence edges into table rows (PBI
 * 2026-09-24-06). The input is the `{ nodes, edges }` graph produced by
 * computeTagCooccurrenceHybrid — the edges ARE the co-occurrence pairs, so
 * no co-occurrence math happens here, only normalization, ranking, and
 * optional single-tag filtering.
 *
 * A selected tag restricts the ranking to edges involving it; the partner
 * and both node counts still come from the FULL graph, because "個別出現数"
 * means the tag's total record count, not its co-occurrence with the
 * selected tag. (Filtering the input records at query time instead would
 * turn the partner count into a joint count and change the semantics.)
 */

import type { TagEdge, TagNode } from './tagCooccurrence.js';

export interface CooccurrenceGraph {
  nodes: TagNode[];
  edges: TagEdge[];
}

/** One ranked co-occurrence pair. tagA is alphabetically first. */
export interface CooccurrencePairRow {
  tagA: string;
  tagB: string;
  /** `#A × #B` display label (alphabetical within the pair). */
  label: string;
  /** Co-occurrence weight (shared-record count). */
  weight: number;
  /** Individual record count of tagA. */
  countA: number;
  /** Individual record count of tagB. */
  countB: number;
}

export interface CooccurrenceTableResult {
  rows: CooccurrencePairRow[];
  /** Pair count before top-N truncation. */
  totalPairs: number;
  /** True when totalPairs exceeds the top-N cap. */
  truncated: boolean;
}

/** Default number of ranked pairs kept (top-20 per the PBI). */
export const COOCCURRENCE_TABLE_TOP_N = 20;

/**
 * Builds the ranked pair rows from the co-occurrence graph.
 *
 * Ranking is deterministic: weight descending, ties broken by pair label
 * ascending (compared as the [tagA, tagB] tuple — identical to comparing
 * the `#A × #B` labels since both share the `#` prefix and the ` × `
 * separator cannot appear inside a tag). `options.tag` restricts the
 * ranking to edges involving that tag; `options.topN` overrides the 20-pair
 * cap (0 or negative keeps nothing).
 */
export function buildCooccurrencePairRows(
  graph: CooccurrenceGraph,
  options?: { tag?: string; topN?: number }
): CooccurrenceTableResult {
  const topN = options?.topN ?? COOCCURRENCE_TABLE_TOP_N;
  const selectedTag = options?.tag;
  const counts = new Map<string, number>();
  for (const node of graph.nodes) {
    counts.set(node.tag, node.count);
  }

  const relevant = selectedTag
    ? graph.edges.filter((edge) => edge.source === selectedTag || edge.target === selectedTag)
    : graph.edges;

  const rows: CooccurrencePairRow[] = relevant.map((edge) => {
    // WHY: normalize the pair alphabetically here instead of trusting the
    // edge orientation — the TS core happens to emit sorted keys, but the
    // helper is also the contract owner for the #A × #B display order.
    const [tagA, tagB] = edge.source <= edge.target ? [edge.source, edge.target] : [edge.target, edge.source];
    return {
      tagA,
      tagB,
      label: `#${tagA} × #${tagB}`,
      weight: edge.weight,
      countA: counts.get(tagA) ?? 0,
      countB: counts.get(tagB) ?? 0,
    };
  });

  rows.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    if (a.tagA !== b.tagA) return a.tagA < b.tagA ? -1 : 1;
    return a.tagB < b.tagB ? -1 : a.tagB > b.tagB ? 1 : 0;
  });

  return {
    rows: rows.slice(0, Math.max(topN, 0)),
    totalPairs: rows.length,
    truncated: rows.length > topN,
  };
}
