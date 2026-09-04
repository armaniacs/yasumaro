/**
 * c2 — main-content candidate scoring.
 *
 * Targets PBI 2026-09-04-03. findMainContentCandidates() re-runs
 * calculateTextScore() inside the sort comparator, so TreeWalker traversal
 * scales with O(N log N) over the candidate set. The treeWalker counter is the
 * primary signal.
 */
import { setupDom } from '../harness/domEnv.mjs';
import { importFromSource } from '../harness/bundle.mjs';
import { spaHeavy } from '../fixtures/_sizes.mjs';

let findMainContentCandidates;

async function ensureLoaded() {
  if (!findMainContentCandidates) {
    const mod = await importFromSource('src/utils/contentExtractor/scoring.ts');
    findMainContentCandidates = mod.findMainContentCandidates;
  }
}

export const definition = {
  id: 'c2',
  description: 'candidate scoring / sort (PBI-03)',
  counters: ['qsa', 'treeWalker', 'reflow'],
  async setup(size) {
    await ensureLoaded();
    const env = setupDom(spaHeavy(size.n));
    return {
      env,
      counters: env.counters,
      resetCounters: () => env.resetCounters(),
      snapshotCounters: () => env.snapshotCounters(),
    };
  },
  run() {
    return findMainContentCandidates();
  },
  teardown(ctx) {
    ctx.env.teardown();
  },
};
