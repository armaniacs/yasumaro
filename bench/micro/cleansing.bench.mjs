/**
 * cleansing — the original scripts/benchmark-cleansing.mjs target, ported onto
 * the shared harness. Measures cleanseAISummaryContent() with all rules on.
 *
 * Kept as a first-class micro bench so `npm run bench:micro` covers it and it
 * shares the counter / percentile / scaling machinery with c1-c7.
 */
import { setupDom } from '../harness/domEnv.mjs';
import { importFromSource } from '../harness/bundle.mjs';

let cleanseAISummaryContent;

const PATTERN_SNIPPETS = [
  '<div class="ad-banner"><span>ad content</span></div>',
  '<nav class="site-nav"><a href="/">Home</a></nav>',
  '<footer>Footer links</footer>',
  '<div class="social-share"><a href="#">Share</a></div>',
  '<div class="recommend-section"><a href="#">Recommended</a></div>',
  '<div class="popup-modal" style="position: fixed">Popup</div>',
  '<div id="cookie-consent">Cookie banner</div>',
  '<div class="jp-layout-sidebar">sidebar</div>',
  '<p>Article paragraph with enough text to survive body protection scoring logic.</p>',
  '<div class="byline-source">byline</div>',
  '<article><p>Body article content paragraph that should be preserved.</p></article>',
  '<section><p>Section content for testing.</p></section>',
];

const ALL_ON_KEYS = [
  'alt', 'metadata', 'ads', 'nav', 'social', 'deep', 'jsonLd', 'lazyLoad', 'skipLink', 'card', 'linkDensity',
  'fixed', 'recommend', 'pagination', 'snsPromo', 'popup', 'cookie', 'platform', 'textDensity', 'shortSeq',
  'symbolLine', 'linkPara', 'enhancedHidden', 'emptyElem', 'jpLayout', 'jpNavigation', 'author', 'affiliate',
  'speechBubble', 'newsMedia', 'ecSite', 'qaSite', 'videoSite',
];

function allOnOptions() {
  const opts = { bodyProtectionEnabled: false };
  for (const k of ALL_ON_KEYS) opts[`${k}Enabled`] = true;
  return opts;
}

function buildHtml(elementCount) {
  const parts = [];
  for (let i = 0; i < elementCount; i++) {
    parts.push(PATTERN_SNIPPETS[i % PATTERN_SNIPPETS.length].replace('>', ` data-bench="${i}">`));
  }
  return `<div id="bench-root">${parts.join('\n')}</div>`;
}

async function ensureLoaded() {
  if (!cleanseAISummaryContent) {
    const mod = await importFromSource('src/utils/aiSummaryCleaner/index.ts');
    cleanseAISummaryContent = mod.cleanseAISummaryContent;
  }
}

export const definition = {
  id: 'cleansing',
  description: 'cleanseAISummaryContent, all 33 rules on (ex scripts/benchmark-cleansing.mjs)',
  counters: ['qsa', 'treeWalker'],
  sizes: [
    { key: 'S', n: 100 },
    { key: 'M', n: 500 },
    { key: 'L', n: 1000 },
  ],
  async setup(size) {
    await ensureLoaded();
    const env = setupDom(buildHtml(size.n));
    const clone = env.document.getElementById('bench-root').cloneNode(true);
    return {
      env,
      clone,
      counters: env.counters,
      resetCounters: () => env.resetCounters(),
      snapshotCounters: () => env.snapshotCounters(),
    };
  },
  run(ctx) {
    return cleanseAISummaryContent(ctx.clone, allOnOptions());
  },
  teardown(ctx) {
    ctx.env.teardown();
  },
};
