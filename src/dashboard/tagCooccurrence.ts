/**
 * tagCooccurrence.ts
 * Computes tag cooccurrence (nodes and edges) from browsing log entries.
 */

import { parseTagsForDisplay } from '../utils/tagUtils.js';
import { MAX_TAGS_PER_RECORD } from '../utils/computeLimits.js';

export interface TagNode {
  tag: string;
  count: number;
}

export interface TagEdge {
  source: string;
  target: string;
  weight: number;
}

export function computeTagCooccurrence(
  entries: Array<{ tags?: string | null }>
): { nodes: TagNode[]; edges: TagEdge[] } {
  const nodeCounts = new Map<string, number>();
  const edgeWeights = new Map<string, number>();

  for (const entry of entries) {
    const tags = parseTagsForDisplay(entry.tags);
    if (tags.length === 0) continue;

    // Cap tags per record BEFORE the double loop: bounds iterations to
    // C(MAX_TAGS_PER_RECORD, 2) and edge count likewise (VULN-041, CWE-400).
    // Kept: first N in parse order — per-record selection is frequency-agnostic;
    // cross-record importance is handled by limitToTopNodes / narrowEntriesToTopTags.
    const uniqueTags = Array.from(new Set(tags)).slice(0, MAX_TAGS_PER_RECORD);

    for (const tag of uniqueTags) {
      nodeCounts.set(tag, (nodeCounts.get(tag) ?? 0) + 1);
    }

    const sorted = [...uniqueTags].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const key = `${sorted[i]}|${sorted[j]}`;
        edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + 1);
      }
    }
  }

  const nodes: TagNode[] = Array.from(nodeCounts.entries()).map(([tag, count]) => ({ tag, count }));
  const edges: TagEdge[] = Array.from(edgeWeights.entries()).map(([key, weight]) => {
    const [source, target] = key.split('|');
    return { source: source ?? '', target: target ?? '', weight };
  });

  return { nodes, edges };
}

/**
 * Narrow a list of log entries so that only the top-N tags by cross-record
 * frequency remain, BEFORE cooccurrence is computed (VULN-053). This keeps the
 * cooccurrence double loop and the downstream force-directed layout bounded even
 * when the history contains thousands of unique tags. Entries keep their other
 * fields; only the `tags` string is filtered. Returns the input array unchanged
 * when the unique-tag count is already within `limit`.
 */
export function narrowEntriesToTopTags<T extends { tags?: string | null }>(
  entries: T[],
  limit: number
): T[] {
  const freq = new Map<string, number>();
  for (const entry of entries) {
    for (const tag of new Set(parseTagsForDisplay(entry.tags))) {
      freq.set(tag, (freq.get(tag) ?? 0) + 1);
    }
  }
  if (freq.size <= limit) {
    return entries;
  }

  const keep = new Set(
    Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, limit)
      .map(([tag]) => tag)
  );

  return entries.map(entry => {
    const filtered = parseTagsForDisplay(entry.tags).filter(t => keep.has(t));
    return { ...entry, tags: filtered.map(t => `#${t}`).join(' ') };
  });
}

export function limitToTopNodes(
  nodes: TagNode[],
  edges: TagEdge[],
  limit: number
): { nodes: TagNode[]; edges: TagEdge[]; truncated: boolean } {
  if (nodes.length <= limit) {
    return { nodes, edges, truncated: false };
  }

  const topNodes = [...nodes].sort((a, b) => b.count - a.count).slice(0, limit);
  const topTagSet = new Set(topNodes.map(n => n.tag));
  const filteredEdges = edges.filter(e => topTagSet.has(e.source) && topTagSet.has(e.target));

  return { nodes: topNodes, edges: filteredEdges, truncated: true };
}
