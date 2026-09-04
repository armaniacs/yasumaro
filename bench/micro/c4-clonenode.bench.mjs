/**
 * c4 — cloneNode duplication in AI-summary cleansing.
 *
 * Targets PBI 2026-09-04-06. extractMainContent() clones the candidate, then
 * cleanseAISummaryContent() clones again internally. The clone counter (deep
 * clones only) and heap p50 are the signals.
 */
import { setupDom } from '../harness/domEnv.mjs';
import { importFromSource } from '../harness/bundle.mjs';
import { newsArticle } from '../fixtures/_sizes.mjs';

let extractMainContent;

async function ensureLoaded() {
  if (!extractMainContent) {
    const mod = await importFromSource('src/utils/contentExtractor/index.ts');
    extractMainContent = mod.extractMainContent;
  }
}

export const definition = {
  id: 'c4',
  description: 'cloneNode duplication in cleansing (PBI-06)',
  counters: ['qsa', 'treeWalker', 'clone'],
  async setup(size) {
    await ensureLoaded();
    const env = setupDom(newsArticle(size.n));
    return {
      env,
      counters: env.counters,
      resetCounters: () => env.resetCounters(),
      snapshotCounters: () => env.snapshotCounters(),
    };
  },
  run() {
    return extractMainContent(
      10000,
      { cleanseEnabled: true },
      { aiSummaryCleanseEnabled: true, adsEnabled: true, navEnabled: true, socialEnabled: true },
    );
  },
  teardown(ctx) {
    ctx.env.teardown();
  },
};
