/**
 * hybridRecallRank.test.ts
 * PBI 2026-10-22-03: RRF fusion pins.
 */
import { describe, it, expect } from 'vitest';
import {
  fuseFtsVectorRanks,
  type HybridRankDocument,
} from '../hybridRecallRank.js';

function makeDocs(): HybridRankDocument[] {
  return [
    { id: 1, title: 'WASM embedding ships in Chrome', summary: 'browser runtime' },
    { id: 2, title: 'potato curry recipe', summary: 'weeknight dinner' },
    { id: 3, title: 'weekly review digest automation', summary: 'reading history' },
  ];
}

describe('fuseFtsVectorRanks', () => {
  it('keeps the FTS-agreed top first when both signals agree', () => {
    const docs = makeDocs();
    const fused = fuseFtsVectorRanks(docs, 'WASM embedding browser', '', new Map([[1, 1], [2, 2], [3, 3]]));
    expect(fused[0]?.id).toBe(1);
  });

  it('orders FTS-missing docs by semantic strength (vector decides ties on the FTS side)', () => {
    const docs = makeDocs();
    const fused = fuseFtsVectorRanks(docs, 'weekly review digest', '', new Map([[1, 1]]));
    const ids = fused.map((entry) => entry.id);
    expect(ids.indexOf(3) < ids.indexOf(2)).toBe(true);
  });

  it('never mutates the input documents', () => {
    const docs = makeDocs();
    const snapshot = docs.map((doc) => ({ ...doc }));
    fuseFtsVectorRanks(docs, 'curry', '', new Map([[2, 1]]));
    expect(docs).toEqual(snapshot);
  });

  it('returns every document exactly once with finite scores', () => {
    const docs = makeDocs();
    const fused = fuseFtsVectorRanks(docs, 'review', '', new Map());
    expect(fused).toHaveLength(docs.length);
    expect(new Set(fused.map((entry) => entry.id)).size).toBe(docs.length);
    for (const entry of fused) {
      expect(Number.isFinite(entry.score)).toBe(true);
    }
  });
});
