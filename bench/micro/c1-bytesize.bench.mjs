/**
 * c1 — content-extraction byte accounting.
 *
 * Targets PBI 2026-09-04-04. Measures extractMainContent() on the non-diagnostic
 * path (returnInfo omitted) and counts TextEncoder.encode calls, which today
 * fire 6-10 times per extraction on large pages.
 */
import { setupDom } from '../harness/domEnv.mjs';
import { importFromSource } from '../harness/bundle.mjs';
import { newsArticle } from '../fixtures/_sizes.mjs';

let extractMainContent;
let encodeCalls = 0;

async function ensureLoaded() {
  if (!extractMainContent) {
    const mod = await importFromSource('src/utils/contentExtractor/index.ts');
    extractMainContent = mod.extractMainContent;
  }
}

export const definition = {
  id: 'c1',
  description: 'byte accounting in content extraction (PBI-04)',
  counters: ['qsa', 'treeWalker', 'reflow', 'encode'],
  async setup(size) {
    await ensureLoaded();
    const env = setupDom(newsArticle(size.n));

    // Count TextEncoder.encode across the run. The bundled contentExtractor
    // resolves `TextEncoder` from the Node global (jsdom does not shadow it),
    // so patch every reachable copy of the prototype.
    const encoders = new Set(
      [globalThis.TextEncoder, env.window.TextEncoder].filter(Boolean),
    );
    const restoreEncoders = [];
    for (const Enc of encoders) {
      const origEncode = Enc.prototype.encode;
      Enc.prototype.encode = function countedEncode(...args) {
        encodeCalls++;
        return origEncode.apply(this, args);
      };
      restoreEncoders.push(() => {
        Enc.prototype.encode = origEncode;
      });
    }

    return {
      env,
      counters: env.counters,
      resetCounters() {
        env.resetCounters();
        encodeCalls = 0;
      },
      snapshotCounters() {
        return { ...env.snapshotCounters(), encode: encodeCalls };
      },
      _restoreEncode() {
        for (const restore of restoreEncoders) restore();
      },
    };
  },
  run() {
    // Non-diagnostic path: returnInfo defaults to false.
    return extractMainContent(10000, { cleanseEnabled: true }, { aiSummaryCleanseEnabled: true });
  },
  teardown(ctx) {
    ctx._restoreEncode();
    ctx.env.teardown();
  },
};
