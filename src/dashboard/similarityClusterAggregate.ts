/**
 * similarityClusterAggregate.ts
 *
 * Similar-article clustering (PBI 2026-10-22-03, slice 1: lexical foundation).
 * 想起化: records covering the same news across media are bundled into one
 * cluster, showing only freshness (last update) and the per-media differences.
 *
 * Slice scope (honest): no WASM embedding exists in the tree yet, so this
 * slice clusters on title-token Jaccard — fully local, no external API
 * (外部APIなしで類似判定ができる). The embedding selection and the hybrid
 * FTS+vector rank fusion ride a later slice; this module's threshold table
 * and cluster shape are the seam that slice plugs into.
 *
 * 縮退の出口: an empty or title-less record never forms a cluster, and
 * singletons are dropped — the panel shows the reason instead of a cluster
 * built on one row. Pure: input records are never mutated (acceptance:
 * クラスタ操作は取り消し可能で元記録を壊さない).
 */

/** The persisted record fields the clustering reads. */
export interface SimilarityRecord {
  id: number;
  title: string;
  url: string;
  domain: string;
  /** Local epoch ms the visit happened at. */
  createdAt: number;
}

/** One bundled cluster: freshness + the per-media differences only. */
export interface SimilarityCluster {
  members: SimilarityRecord[];
  /** The newest visit in the cluster (鮮度: 最終更新). */
  freshestAt: number;
  /** Covering media, oldest-first (多角的差分: which media covered it). */
  domains: string[];
}

/** Title-token Jaccard at or above this bundles two records. */
export const SIMILARITY_THRESHOLD = 0.5;

/** Clusters need at least this many members (少件数の縮退). */
export const MIN_CLUSTER_SIZE = 2;

/** Minimal ja/en stopwords: glue tokens that would fake a similarity. */
const STOPWORDS: ReadonlySet<string> = new Set([
  'the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'with',
  'の', 'に', 'は', 'を', 'が', 'で', 'と', 'も', 'から', 'まで', 'より',
]);

/**
 * Title tokens: lowercase ASCII, split on whitespace and CJK/Latin
 * punctuation, stopwords and empties dropped. Unknown shapes fail closed
 * to an empty set (never a throw).
 */
export function tokenizeTitle(title: string): Set<string> {
  const tokens = new Set<string>();
  if (typeof title !== 'string') return tokens;
  for (const raw of title.split(/[\s\-_・、。,.!?()（）「」『』:：;；/／|｜\[\]【】…―]+/u)) {
    const token = raw.trim().toLowerCase();
    if (token === '' || STOPWORDS.has(token)) continue;
    tokens.add(token);
  }
  return tokens;
}

/** Jaccard similarity of two title-token sets (empty pair = 0, never NaN). */
export function titleSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}

/**
 * Greedy single-link clustering on title similarity. 縮退の出口: title-less
 * records never join, singletons are dropped. The input array is never
 * mutated — clusters carry references to the same record objects.
 */
export function buildSimilarityClusters(records: SimilarityRecord[]): SimilarityCluster[] {
  const tokenized = records
    .filter((r) => typeof r.title === 'string' && r.title.trim() !== '')
    .map((record) => ({ record, tokens: tokenizeTitle(record.title) }))
    .filter((entry) => entry.tokens.size > 0);

  const assigned = new Array<boolean>(tokenized.length).fill(false);
  const clusters: SimilarityCluster[] = [];
  for (let i = 0; i < tokenized.length; i++) {
    if (assigned[i] === true) continue;
    const seed = tokenized[i];
    if (seed === undefined) continue;
    const members: SimilarityRecord[] = [seed.record];
    assigned[i] = true;
    for (let j = i + 1; j < tokenized.length; j++) {
      if (assigned[j] === true) continue;
      const candidate = tokenized[j];
      if (candidate === undefined) continue;
      if (titleSimilarity(seed.tokens, candidate.tokens) >= SIMILARITY_THRESHOLD) {
        members.push(candidate.record);
        assigned[j] = true;
      }
    }
    if (members.length < MIN_CLUSTER_SIZE) continue;
    members.sort((a, b) => a.createdAt - b.createdAt);
    const domains: string[] = [];
    for (const member of members) {
      if (!domains.includes(member.domain)) domains.push(member.domain);
    }
    const freshestAt = members.length > 0 ? members[members.length - 1]?.createdAt ?? 0 : 0;
    clusters.push({ members, freshestAt, domains });
  }
  // Biggest clusters first: the most-covered news reads first.
  clusters.sort((a, b) => b.members.length - a.members.length);
  return clusters;
}
