/**
 * c7 — sentence-level dedup cost.
 *
 * Targets PBI 2026-09-04-08. deduplicateContent() compares each sentence
 * against every kept sentence (O(N^2) Jaccard). The jaccard_calls counter and
 * the scaling exponent across S/M/L are the signals — a fix should pull the
 * exponent down from ~2 toward ~1.
 */
import { importFromSource } from '../harness/bundle.mjs';
import { longText } from '../fixtures/_sizes.mjs';

let deduplicateContent;

async function ensureLoaded() {
  if (!deduplicateContent) {
    const mod = await importFromSource('src/utils/contentDeduplicator.ts');
    deduplicateContent = mod.deduplicateContent;
  }
}

export const definition = {
  id: 'c7',
  description: 'sentence dedup O(N^2) Jaccard (PBI-08)',
  // No counters: the jaccardSimilarity call count lives inside the standalone
  // bundle and has no hook yet. wall p95 + the scaling exponent across S/M/L
  // are the primary signal — PBI-08 should pull the exponent from ~2 toward ~1.
  counters: [],
  sizes: [
    { key: 'S', n: 1 }, // ~100 sentences
    { key: 'M', n: 4 }, // ~400
    { key: 'L', n: 12 }, // ~1200
  ],
  async setup(size) {
    await ensureLoaded();
    const text = longText(size.n, { dupRatio: 0.1 });
    return { text };
  },
  run(ctx) {
    return deduplicateContent(ctx.text, { threshold: 0.7 });
  },
};
