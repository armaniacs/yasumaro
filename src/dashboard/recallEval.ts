/**
 * recallEval.ts
 *
 * Recall comparison harness (PBI 2026-10-22-03): FTS-only vs hybrid
 * FTS+vector over the fixed EVAL_CORPUS. The FTS side is a local
 * character-gram overlap rank — the closest dependency-free approximation of
 * the production FTS5 trigram MATCH path (token-exact overlap would score 0
 * on unspaced Japanese and understate the real baseline). The hybrid side
 * fuses it with character-gram-vector cosine via fuseFtsVectorRanks. Pure
 * and deterministic: same corpus + same queries always yield the same
 * report. The report carries recall@3 (the PBI acceptance metric) and MRR
 * (rank quality inside the top set, which separates ties).
 */

import { EVAL_CORPUS, EVAL_QUERIES } from './evalCorpus.js';
import { fuseFtsVectorRanks, type FtsRankTable } from './hybridRecallRank.js';
import { semanticCharGrams } from './semanticVector.js';

export interface RecallEvalQueryReport {
  queryId: string;
  ftsRecallAt3: number;
  hybridRecallAt3: number;
  ftsMrr: number;
  hybridMrr: number;
}

export interface RecallEvalReport {
  queries: RecallEvalQueryReport[];
  meanFtsRecallAt3: number;
  meanHybridRecallAt3: number;
  meanFtsMrr: number;
  meanHybridMrr: number;
  /** Non-regression: fusion must not score below FTS-only on either metric. */
  hybridHolds: boolean;
}

function overlapRank(queryText: string): number[] {
  const queryTrigrams = new Set(semanticCharGrams(queryText));
  const scored = EVAL_CORPUS.map((doc) => {
    const docTrigrams = new Set(semanticCharGrams(`${doc.title} ${doc.summary}`));
    let overlap = 0;
    for (const trigram of queryTrigrams) {
      if (docTrigrams.has(trigram)) overlap++;
    }
    return { id: doc.id, overlap };
  });
  scored.sort((a, b) => b.overlap - a.overlap || a.id - b.id);
  return scored.map((entry) => entry.id);
}

function recallAtK(ranked: number[], relevantIds: number[], k: number): number {
  if (relevantIds.length === 0) return 1;
  const top = new Set(ranked.slice(0, k));
  let hits = 0;
  for (const id of relevantIds) {
    if (top.has(id)) hits++;
  }
  return hits / relevantIds.length;
}

function meanRankReciprocal(ranked: number[], relevantIds: number[]): number {
  if (relevantIds.length === 0) return 1;
  let sum = 0;
  for (const id of relevantIds) {
    sum += 1 / (ranked.indexOf(id) + 1);
  }
  return sum / relevantIds.length;
}

export function evaluateRecallAt3(): RecallEvalReport {
  const queries: RecallEvalQueryReport[] = EVAL_QUERIES.map((query) => {
    const ftsOrder = overlapRank(query.text);
    const ftsTable: FtsRankTable = new Map(ftsOrder.map((id, index) => [id, index + 1]));
    const hybridOrder = fuseFtsVectorRanks(EVAL_CORPUS, query.text, '', ftsTable).map((entry) => entry.id);
    return {
      queryId: query.id,
      ftsRecallAt3: recallAtK(ftsOrder, query.relevantIds, 3),
      hybridRecallAt3: recallAtK(hybridOrder, query.relevantIds, 3),
      ftsMrr: meanRankReciprocal(ftsOrder, query.relevantIds),
      hybridMrr: meanRankReciprocal(hybridOrder, query.relevantIds),
    };
  });
  const mean = (values: number[]): number =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
  const meanFtsRecallAt3 = mean(queries.map((query) => query.ftsRecallAt3));
  const meanHybridRecallAt3 = mean(queries.map((query) => query.hybridRecallAt3));
  const meanFtsMrr = mean(queries.map((query) => query.ftsMrr));
  const meanHybridMrr = mean(queries.map((query) => query.hybridMrr));
  return {
    queries,
    meanFtsRecallAt3,
    meanHybridRecallAt3,
    meanFtsMrr,
    meanHybridMrr,
    hybridHolds: meanHybridRecallAt3 >= meanFtsRecallAt3 && meanHybridMrr >= meanFtsMrr,
  };
}
