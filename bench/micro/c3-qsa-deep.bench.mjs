/**
 * c3 — querySelectorAllDeep recursion.
 *
 * Targets PBI 2026-09-04-05. Runs the deep query over a page WITHOUT shadow DOM
 * (the common case) and one WITH shadow roots. The qsa counter shows how many
 * `querySelectorAll('*')` full enumerations the recursion triggers.
 */
import { setupDom } from '../harness/domEnv.mjs';
import { importFromSource } from '../harness/bundle.mjs';
import { newsArticle, shadowDom } from '../fixtures/_sizes.mjs';

let querySelectorAllDeep;

async function ensureLoaded() {
  if (!querySelectorAllDeep) {
    const mod = await importFromSource('src/utils/aiSummaryCleaner/helpers.ts');
    querySelectorAllDeep = mod.querySelectorAllDeep;
  }
}

const SELECTOR = 'nav, footer, .ad-banner, .social-share, [style*="position: fixed"]';

/** @param {'plain'|'shadow'} variant */
function makeDefinition(variant) {
  return {
    id: variant === 'plain' ? 'c3' : 'c3-shadow',
    description:
      variant === 'plain'
        ? 'deep query, no shadow DOM (PBI-05)'
        : 'deep query, with shadow roots (PBI-05, regression guard)',
    counters: ['qsa', 'treeWalker', 'reflow'],
    async setup(size) {
      await ensureLoaded();
      if (variant === 'plain') {
        const env = setupDom(newsArticle(size.n));
        return wrap(env, () => querySelectorAllDeep(env.document.body, SELECTOR));
      }
      const fx = shadowDom(size.n);
      const env = setupDom(fx.html);
      fx.attachShadows(env.document);
      return wrap(env, () => querySelectorAllDeep(env.document.body, SELECTOR));
    },
    run(ctx) {
      return ctx._invoke();
    },
    teardown(ctx) {
      ctx.env.teardown();
    },
  };
}

function wrap(env, invoke) {
  return {
    env,
    counters: env.counters,
    resetCounters: () => env.resetCounters(),
    snapshotCounters: () => env.snapshotCounters(),
    _invoke: invoke,
  };
}

export const definition = makeDefinition('plain');
export const shadowDefinition = makeDefinition('shadow');
