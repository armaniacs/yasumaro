import type { SavedUrlEntry } from '../utils/storageUrls.js';

export interface CleansingStats {
  count: number;
  avgPageBytes: number;
  avgFinalBytes: number;
  avgReductionRate: number;
  totalSavedBytes: number;
  funnelAvg: {
    page: number;
    candidate: number;
    cleansed: number;
    aiCleansed: number;
  };
}

export function computeCleansingStats(entries: SavedUrlEntry[]): CleansingStats {
  const valid = entries.filter(e => e.pageBytes !== undefined && (e.aiSummaryCleansedBytes !== undefined || e.cleansedBytes !== undefined));

  if (valid.length === 0) {
    return { count: 0, avgPageBytes: 0, avgFinalBytes: 0, avgReductionRate: 0, totalSavedBytes: 0, funnelAvg: { page: 0, candidate: 0, cleansed: 0, aiCleansed: 0 } };
  }

  let sumPage = 0;
  let sumCandidate = 0;
  let sumCleansed = 0;
  let sumAiCleansed = 0;
  let sumFinal = 0;
  let sumReductionRate = 0;
  let sumSaved = 0;

  for (const e of valid) {
    const page = e.pageBytes!;
    const candidate = e.candidateBytes ?? page;
    const cleansed = e.cleansedBytes ?? candidate;
    const aiCleansed = e.aiSummaryCleansedBytes ?? cleansed;
    const final = aiCleansed;
    const saved = page - final;
    const rate = page > 0 ? (saved / page) * 100 : 0;

    sumPage += page;
    sumCandidate += candidate;
    sumCleansed += cleansed;
    sumAiCleansed += aiCleansed;
    sumFinal += final;
    sumReductionRate += rate;
    sumSaved += saved;
  }

  const n = valid.length;
  return {
    count: n,
    avgPageBytes: Math.round(sumPage / n),
    avgFinalBytes: Math.round(sumFinal / n),
    avgReductionRate: sumReductionRate / n,
    totalSavedBytes: sumSaved,
    funnelAvg: {
      page: Math.round(sumPage / n),
      candidate: Math.round(sumCandidate / n),
      cleansed: Math.round(sumCleansed / n),
      aiCleansed: Math.round(sumAiCleansed / n),
    },
  };
}