/**
 * tagCooccurrence.ts
 * Computes tag cooccurrence (nodes and edges) from browsing log entries.
 */

import { parseTagsForDisplay } from '../utils/tagUtils.js';

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

    const uniqueTags = Array.from(new Set(tags));

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
    return { source, target, weight };
  });

  return { nodes, edges };
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
