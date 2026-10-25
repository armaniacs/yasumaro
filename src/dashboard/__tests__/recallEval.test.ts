/**
 * recallEval.test.ts
 * PBI 2026-10-22-03: fixed-corpus recall comparison (FTS-only vs hybrid).
 */
import { describe, it, expect } from 'vitest';
import { EVAL_CORPUS, EVAL_QUERIES } from '../evalCorpus.js';
import { evaluateRecallAt3 } from '../recallEval.js';

describe('eval corpus (fixed)', () => {
  it('freezes 15 documents (12 topical + 3 near-miss distractors) and 4 queries', () => {
    expect(EVAL_CORPUS).toHaveLength(15);
    expect(EVAL_QUERIES.map((query) => query.id)).toEqual(['q-wasm', 'q-curry', 'q-review', 'q-resume']);
    for (const query of EVAL_QUERIES) {
      expect(query.relevantIds.length).toBeGreaterThan(0);
    }
  });
});

describe('evaluateRecallAt3', () => {
  it('is deterministic across runs', () => {
    expect(evaluateRecallAt3()).toEqual(evaluateRecallAt3());
  });

  it('holds the FTS-only baseline on recall and rank quality (fusion is a non-regression)', () => {
    const report = evaluateRecallAt3();
    expect(report.queries).toHaveLength(EVAL_QUERIES.length);
    for (const query of report.queries) {
      expect(query.hybridRecallAt3).toBeGreaterThanOrEqual(query.ftsRecallAt3);
      expect(query.hybridMrr).toBeGreaterThanOrEqual(query.ftsMrr);
    }
    expect(report.hybridHolds).toBe(true);
    expect(report.meanHybridRecallAt3).toBeGreaterThanOrEqual(report.meanFtsRecallAt3);
    expect(report.meanHybridMrr).toBeGreaterThanOrEqual(report.meanFtsMrr);
  });
});
