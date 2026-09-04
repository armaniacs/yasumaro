/**
 * _sizes.mjs — synthetic page/content generators for micro benchmarks.
 *
 * Network-independent: benches build DOM strings from these helpers rather than
 * loading real captured pages, so results are reproducible across machines.
 * The S/M/L multipliers map to the runner's default sizes (n = 1 / 4 / 16).
 */

const PARAGRAPH =
  'This is a representative body paragraph with enough natural-language text to ' +
  'survive readability scoring and content-cleansing thresholds without being ' +
  'treated as boilerplate or navigation chrome.';

const NOISE_SNIPPETS = [
  '<nav class="site-nav"><a href="/">Home</a><a href="/about">About</a></nav>',
  '<div class="ad-banner"><span>sponsored</span></div>',
  '<footer class="site-footer"><a href="/tos">Terms</a></footer>',
  '<div class="social-share"><a href="#">Tweet</a><a href="#">Share</a></div>',
  '<div id="cookie-consent" style="position: fixed">We use cookies</div>',
  '<div class="recommend-section"><a href="#">You may also like</a></div>',
];

/** @param {number} n paragraphs */
function paragraphs(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(`<p data-i="${i}">${PARAGRAPH} (para ${i})</p>`);
    if (i % 5 === 4) out.push(`<h2>Section ${i / 5}</h2>`);
  }
  return out.join('\n');
}

/** @param {number} n noise blocks interleaved */
function noise(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(NOISE_SNIPPETS[i % NOISE_SNIPPETS.length]);
  return out.join('\n');
}

/**
 * A news-article-shaped page: one <article> wrapped in site chrome.
 * @param {number} scale  S=1, M=4, L=16
 */
export function newsArticle(scale) {
  const paraCount = 20 * scale;
  const noiseCount = 8 * scale;
  return `
    ${noise(noiseCount)}
    <header><h1>Breaking: Benchmark Fixture Generated</h1></header>
    <article>
      <p class="byline">By Bench Harness</p>
      ${paragraphs(paraCount)}
    </article>
    ${noise(noiseCount)}
  `;
}

/**
 * SPA-shaped page: no <article>/<main>, lots of <div>/<section> so the scorer
 * has to walk a big candidate set.
 * @param {number} scale
 */
export function spaHeavy(scale) {
  const blocks = 40 * scale;
  const out = [];
  for (let i = 0; i < blocks; i++) {
    out.push(
      `<section class="block-${i}"><div class="inner">` +
        `<p>${PARAGRAPH} block ${i}</p><p>${PARAGRAPH} more ${i}</p>` +
        `</div></section>`,
    );
  }
  return `<div id="app">${noise(6 * scale)}${out.join('\n')}</div>`;
}

/**
 * Long-form text (no markup) for the dedup bench. Roughly `100 * scale`
 * sentences with a controllable number of near-duplicate pairs.
 * @param {number} scale
 * @param {{ dupRatio?: number }} [opts]
 */
export function longText(scale, opts = {}) {
  const { dupRatio = 0.1 } = opts;
  const total = 100 * scale;
  const dupCount = Math.floor(total * dupRatio);
  const sentences = [];
  for (let i = 0; i < total - dupCount; i++) {
    sentences.push(`The quick brown fox number ${i} jumps over the lazy dog near location ${i % 7}.`);
  }
  // near-duplicates of earlier sentences (word-order tweak)
  for (let i = 0; i < dupCount; i++) {
    sentences.push(`The quick brown fox number ${i} jumps over the lazy dog near location ${i % 7} again.`);
  }
  return sentences.join(' ');
}

/**
 * Page with `2 * scale` open shadow roots (3 levels deep each) plus a plain
 * article, to exercise querySelectorAllDeep.
 * @param {number} scale
 */
export function shadowDom(scale) {
  const hostCount = 2 * scale;
  const hosts = [];
  for (let i = 0; i < hostCount; i++) hosts.push(`<div class="shadow-host" data-h="${i}"></div>`);
  return {
    html: `<article>${paragraphs(15 * scale)}</article>${hosts.join('')}${noise(4 * scale)}`,
    /**
     * Call after the DOM exists to attach shadow roots (JSDOM supports
     * attachShadow). Returns the number of roots attached.
     * @param {Document} doc
     */
    attachShadows(doc) {
      let attached = 0;
      for (const host of doc.querySelectorAll('.shadow-host')) {
        try {
          const root = host.attachShadow({ mode: 'open' });
          root.innerHTML =
            '<nav>shadow nav</nav><div class="l1"><div class="l2">' +
            '<footer>shadow footer</footer></div></div>';
          attached++;
        } catch {
          /* environment without attachShadow */
        }
      }
      return attached;
    },
  };
}

export const FIXTURES = { newsArticle, spaHeavy, longText, shadowDom };
