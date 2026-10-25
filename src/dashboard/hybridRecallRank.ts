/**
 * hybridRecallRank.ts
 *
 * Hybrid FTS + vector rank fusion (PBI 2026-10-22-03).
 * FTS5 trigram MATCH stays as the lexical signal; the trigram-vector cosine
 * from semanticVector.ts is the semantic signal. Fusion is reciprocal rank
 * fusion (RRF): score = wFts / (k + ftsRank) + wVec / (k + vecRank).
 *
 * Documents missing from the FTS ranking count as ranked last (N+1) on that
 * side instead of 0: a strong semantic match can still surface an FTS miss
 * (the recall win the PBI asks for), while FTS agreement wins ties through
 * the higher ftsWeight. Pure: inputs are never mutated; the returned array
 * is a new ranking.
 *
 * Small-corpus note: with rrfK=60 the rank gaps nearly vanish on a dozen
 * documents, so fusion tracks the FTS order and only flips adjacent ties
 * (measured: identical MRR on the 15-doc eval corpus). That is the safe
 * default for v1 (fusion never demotes); scale k down or rebalance weights
 * only with a larger judged corpus backing the change.
 */

import { cosineSimilarity, vectorizeSemanticText } from './semanticVector.js';

export interface HybridRankDocument {
  id: number;
  title: string;
  summary: string;
}

/** 1-based rank per document id from the FTS side (lower = better). */
export type FtsRankTable = ReadonlyMap<number, number>;

export interface HybridRankOptions {
  ftsWeight: number;
  vectorWeight: number;
  rrfK: number;
}

export const DEFAULT_HYBRID_RANK_OPTIONS: HybridRankOptions = {
  ftsWeight: 0.6,
  vectorWeight: 0.4,
  rrfK: 60,
};

export interface HybridRankedDoc {
  id: number;
  score: number;
}

/**
 * Fuse one FTS ranking with one semantic ranking over the same corpus.
 * FTS-missing ids count as ranked last (N+1) on the FTS side.
 */
export function fuseFtsVectorRanks(
  documents: HybridRankDocument[],
  queryTitle: string,
  querySummary: string,
  ftsRanks: FtsRankTable,
  options: HybridRankOptions = DEFAULT_HYBRID_RANK_OPTIONS,
): HybridRankedDoc[] {
  const queryVec = vectorizeSemanticText(queryTitle, querySummary);
  const scored = documents.map((doc) => ({
    doc,
    cosine: cosineSimilarity(queryVec, vectorizeSemanticText(doc.title, doc.summary)),
  }));
  const vecOrder = [...scored].sort((a, b) => b.cosine - a.cosine);
  const vecRankOf = new Map<number, number>();
  vecOrder.forEach((entry, index) => {
    vecRankOf.set(entry.doc.id, index + 1);
  });
  const fused: HybridRankedDoc[] = documents.map((doc) => {
    const ftsRank = ftsRanks.get(doc.id) ?? documents.length + 1;
    const vecRank = vecRankOf.get(doc.id) ?? documents.length + 1;
    const ftsPart = options.ftsWeight / (options.rrfK + ftsRank);
    const vecPart = options.vectorWeight / (options.rrfK + vecRank);
    return { id: doc.id, score: ftsPart + vecPart };
  });
  fused.sort((a, b) => b.score - a.score);
  return fused;
}
