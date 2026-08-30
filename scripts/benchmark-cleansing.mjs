#!/usr/bin/env node
/**
 * Benchmark for aiSummaryCleaner — 30-04
 *
 * M5決定: PoCなし、現行 cleanseAISummaryContent のみを jsdom 上で計測。
 * 10ms 未満なら「集約不要」、10ms 以上なら「要1パス検討」。
 *
 * - 100 / 500 / 1000 要素の DOM サイズ別に各 3 回実行し中央値をレポート
 * - performance.mark / performance.measure で計測
 * - querySelectorAll 呼び出し回数をインストルメント（環境変数 BENCHMARK_COUNT_QSA=1 で ON。デフォルト ON）
 * - 出力: dev-docs/benchmark-cleansing-2026-08-30.md
 *
 * 実行: node scripts/benchmark-cleansing.mjs
 *       BENCHMARK_COUNT_QSA=0 node scripts/benchmark-cleansing.mjs  # カウント無し
 *
 * 実装メモ: src は TypeScript (ESM, .js 拡張子 import) のため、plain node では
 * 直接 import できない。esbuild で一時バンドルしてから import することで
 * `node scripts/benchmark-cleansing.mjs` が依存追加なしで動作する。
 */

import { performance } from 'node:perf_hooks';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const COUNT_QSA = process.env.BENCHMARK_COUNT_QSA !== '0';

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

function buildHtml(elementCount) {
  const parts = [];
  for (let i = 0; i < elementCount; i++) {
    const snippet = PATTERN_SNIPPETS[i % PATTERN_SNIPPETS.length];
    parts.push(snippet.replace('>', ` data-bench="${i}">`));
  }
  return `<div id="bench-root">${parts.join('\n')}</div>`;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function createInstrumentedDom(html) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
  const { window } = dom;
  const g = globalThis;
  g.window = window;
  g.document = window.document;
  g.Node = window.Node;
  g.Element = window.Element;
  g.HTMLElement = window.HTMLElement;
  g.DocumentFragment = window.DocumentFragment;
  g.Blob = window.Blob;
  g.DOMParser = window.DOMParser;

  let qsaCount = 0;
  const origElemQSA = window.Element.prototype.querySelectorAll;
  const origDocQSA = window.Document.prototype.querySelectorAll;
  if (COUNT_QSA) {
    window.Element.prototype.querySelectorAll = function (...args) {
      qsaCount++;
      return origElemQSA.apply(this, args);
    };
    window.Document.prototype.querySelectorAll = function (...args) {
      qsaCount++;
      return origDocQSA.apply(this, args);
    };
  }

  return {
    dom,
    window,
    origElemQSA,
    origDocQSA,
    getQsaCount: () => qsaCount,
    resetQsaCount: () => { qsaCount = 0; },
  };
}

function teardownDom(inst) {
  // restore prototypes to avoid leaking patched count into next JSDOM
  if (inst.origElemQSA) inst.window.Element.prototype.querySelectorAll = inst.origElemQSA;
  if (inst.origDocQSA) inst.window.Document.prototype.querySelectorAll = inst.origDocQSA;
}

function restoreGlobals(previous) {
  for (const k of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'DocumentFragment', 'Blob', 'DOMParser']) {
    if (previous[k] !== undefined) globalThis[k] = previous[k];
    else delete globalThis[k];
  }
}

function buildAllOnOptions() {
  const keys = [
    'alt','metadata','ads','nav','social','deep','jsonLd','lazyLoad','skipLink','card','linkDensity',
    'fixed','recommend','pagination','snsPromo','popup','cookie','platform','textDensity','shortSeq','symbolLine','linkPara',
    'enhancedHidden','emptyElem','jpLayout','jpNavigation','author','affiliate','speechBubble',
    'newsMedia','ecSite','qaSite','videoSite'
  ];
  // bodyProtection を無効化して純粋なクレンジング走査を計測。デフォルト側と条件を揃えるため両方 false。
  const opts = { bodyProtectionEnabled: false };
  for (const k of keys) opts[`${k}Enabled`] = true;
  return opts;
}

function getJsdomVersion() {
  try {
    const pkg = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'));
    return pkg.devDependencies?.jsdom ?? pkg.dependencies?.jsdom ?? 'unknown';
  } catch { return 'unknown'; }
}

async function bundleCleaner() {
  const esbuild = await import('esbuild');
  const outPath = resolve(tmpdir(), `yasumaro-benchmark-cleansing-${Date.now()}.mjs`);
  await esbuild.build({
    entryPoints: [resolve(projectRoot, 'src/utils/aiSummaryCleaner/index.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    outfile: outPath,
    logLevel: 'silent',
  });
  return outPath;
}

const DOM_SIZES = [100, 500, 1000];
const RUNS_PER_SIZE = 3;
const THRESHOLD_MS = 10;

async function main() {
  const prevGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    Node: globalThis.Node,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
    DocumentFragment: globalThis.DocumentFragment,
    Blob: globalThis.Blob,
    DOMParser: globalThis.DOMParser,
  };

  // Bootstrap minimal globals so the bundler's output (which doesn't touch DOM at import time) loads safely
  const bootstrap = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  globalThis.window = bootstrap.window;
  globalThis.document = bootstrap.window.document;
  globalThis.Node = bootstrap.window.Node;
  globalThis.Element = bootstrap.window.Element;
  globalThis.HTMLElement = bootstrap.window.HTMLElement;
  globalThis.DocumentFragment = bootstrap.window.DocumentFragment;
  globalThis.Blob = bootstrap.window.Blob;
  globalThis.DOMParser = bootstrap.window.DOMParser;

  const bundlePath = await bundleCleaner();
  const { cleanseAISummaryContent } = await import(bundlePath);

  restoreGlobals(prevGlobals);

  // dynamically import cleanup — remove tmp bundle after import (module already evaluated)
  try { (await import('node:fs')).unlinkSync(bundlePath); } catch {}

  const allOnOptions = buildAllOnOptions();
  const defaultOptions = { bodyProtectionEnabled: false };

  const results = [];

  for (const size of DOM_SIZES) {
    const timingsAllOn = [];
    const qsaAllOn = [];
    const removedAllOn = [];
    const timingsDefault = [];
    const qsaDefault = [];
    const removedDefault = [];

    for (let run = 0; run < RUNS_PER_SIZE; run++) {
      // --- All ON ---
      {
        const html = buildHtml(size);
        const inst = createInstrumentedDom(html);
        const root = inst.window.document.getElementById('bench-root');
        const clone = root.cloneNode(true);

        const markStart = `cleansing-${size}-allon-${run}-start`;
        const markEnd = `cleansing-${size}-allon-${run}-end`;
        const measureName = `cleansing-${size}-allon-${run}`;

        inst.resetQsaCount();
        performance.mark(markStart);
        const t0 = performance.now();
        const res = cleanseAISummaryContent(clone, allOnOptions);
        const t1 = performance.now();
        performance.mark(markEnd);
        try { performance.measure(measureName, markStart, markEnd); } catch {}
        timingsAllOn.push(t1 - t0);
        qsaAllOn.push(inst.getQsaCount());
        removedAllOn.push(res.totalRemoved);
        try { performance.clearMarks(markStart); performance.clearMarks(markEnd); performance.clearMeasures(measureName); } catch {}
        teardownDom(inst);
        restoreGlobals(prevGlobals);
      }

      // --- Default ---
      {
        const html = buildHtml(size);
        const inst = createInstrumentedDom(html);
        const root = inst.window.document.getElementById('bench-root');
        const clone = root.cloneNode(true);

        const markStart = `cleansing-${size}-default-${run}-start`;
        const markEnd = `cleansing-${size}-default-${run}-end`;
        const measureName = `cleansing-${size}-default-${run}`;

        inst.resetQsaCount();
        performance.mark(markStart);
        const t0 = performance.now();
        const res = cleanseAISummaryContent(clone, defaultOptions);
        const t1 = performance.now();
        performance.mark(markEnd);
        try { performance.measure(measureName, markStart, markEnd); } catch {}
        timingsDefault.push(t1 - t0);
        qsaDefault.push(inst.getQsaCount());
        removedDefault.push(res.totalRemoved);
        try { performance.clearMarks(markStart); performance.clearMarks(markEnd); performance.clearMeasures(measureName); } catch {}
        teardownDom(inst);
        restoreGlobals(prevGlobals);
      }
    }

    results.push({
      size,
      timingsAllOn, qsaAllOn, removedAllOn,
      timingsDefault, qsaDefault, removedDefault,
    });
  }

  restoreGlobals(prevGlobals);

  const mediansAllOn = results.map(r => median(r.timingsAllOn));
  const maxMedianAllOn = Math.max(...mediansAllOn);
  const verdict = maxMedianAllOn < THRESHOLD_MS ? '集約不要' : '要1パス検討';
  const verdictDetail = maxMedianAllOn < THRESHOLD_MS
    ? `最大中央値 ${maxMedianAllOn.toFixed(3)}ms < ${THRESHOLD_MS}ms のため、74回走査の1パス集約は現時点では不要。オーバーヘッドは無視できる。`
    : `最大中央値 ${maxMedianAllOn.toFixed(3)}ms ≥ ${THRESHOLD_MS}ms のため、30-05 で1パス集約を検討する価値あり。`;

  const nowIso = new Date().toISOString();
  const jsdomVer = getJsdomVersion();
  const reportLines = [];
  reportLines.push(`# Cleansing Benchmark — 2026-08-30`);
  reportLines.push('');
  reportLines.push(`- 計測日時: ${nowIso}`);
  reportLines.push(`- 環境: Node ${process.version} + jsdom ${jsdomVer} (jsdom 計測は参考値。実ブラウザでは Playwright \`page.evaluate\` での再計測を推奨)`);
  reportLines.push(`- 計測対象: \`cleanseAISummaryContent\` (現行実装) — \`performance.mark\`/\`measure\` + \`performance.now()\` 差分`);
  reportLines.push(`- インストルメント: \`querySelectorAll\` 呼び出し回数カウント \`${COUNT_QSA ? 'ON' : 'OFF'}\` (環境変数 \`BENCHMARK_COUNT_QSA\`)`);
  reportLines.push(`- DOM生成: 現実的なパターン混合スニペット ${PATTERN_SNIPPETS.length}種類を循環して要素数に合わせて生成 (\`#bench-root\` 配下)`);
  reportLines.push(`- 試行: 各DOMサイズにつき ${RUNS_PER_SIZE}回実行し中央値を採用、個別値も併記`);
  reportLines.push(`- 閾値: ${THRESHOLD_MS}ms`);
  reportLines.push('');
  reportLines.push(`## 判定`);
  reportLines.push('');
  reportLines.push(`**${verdict}** — ${verdictDetail}`);
  reportLines.push('');
  reportLines.push(`> M5方針: 本ベンチマークは現行実装の軽量計測のみ。\`singlePass.poc.ts\` は作成しない。10ms未満なら集約は見送り、10ms以上なら 30-05 の検討材料とする。`);
  reportLines.push('');
  reportLines.push(`## サマリ (中央値)`);
  reportLines.push('');
  reportLines.push(`| DOMサイズ | Config | 中央値 (ms) | 最大 (ms) | querySelectorAll 中央値 | 削除数 中央値 |`);
  reportLines.push(`|---:|---|---:|---:|---:|---:|`);
  for (const r of results) {
    const medAll = median(r.timingsAllOn);
    const maxAll = Math.max(...r.timingsAllOn);
    reportLines.push(`| ${r.size} | 全32ルールON | ${medAll.toFixed(3)} | ${maxAll.toFixed(3)} | ${median(r.qsaAllOn)} | ${median(r.removedAllOn)} |`);
    const medDef = median(r.timingsDefault);
    const maxDef = Math.max(...r.timingsDefault);
    reportLines.push(`| ${r.size} | デフォルト(7ON) | ${medDef.toFixed(3)} | ${maxDef.toFixed(3)} | ${median(r.qsaDefault)} | ${median(r.removedDefault)} |`);
  }
  reportLines.push('');
  reportLines.push(`## 詳細 (全試行)`);
  reportLines.push('');
  reportLines.push(`| DOMサイズ | Config | Run | 実行時間 (ms) | querySelectorAll呼び出し | 削除数 |`);
  reportLines.push(`|---:|---|---:|---:|---:|---:|`);
  for (const r of results) {
    for (let i = 0; i < RUNS_PER_SIZE; i++) {
      reportLines.push(`| ${r.size} | 全ON | ${i + 1} | ${r.timingsAllOn[i].toFixed(3)} | ${r.qsaAllOn[i]} | ${r.removedAllOn[i]} |`);
    }
    for (let i = 0; i < RUNS_PER_SIZE; i++) {
      reportLines.push(`| ${r.size} | デフォルト | ${i + 1} | ${r.timingsDefault[i].toFixed(3)} | ${r.qsaDefault[i]} | ${r.removedDefault[i]} |`);
    }
  }
  reportLines.push('');
  reportLines.push(`## 解釈と次のアクション`);
  reportLines.push('');
  if (verdict === '集約不要') {
    reportLines.push(`- 現行の74回 (\`grep -c querySelectorAll\`相当) 走査でも 1000要素で中央値 ${maxMedianAllOn.toFixed(3)}ms と十分高速。1パス(\`querySelectorAll('*')\` 1回 + Map分類)への集約はコストに見合わない。`);
    reportLines.push(`- 30-05 最適化PBIは優先度を下げるか見送りを推奨。実ブラウザでの再計測が必要なら Playwright \`page.evaluate\` で同一ロジックを再実行すること。`);
  } else {
    reportLines.push(`- 1000要素で中央値 ${maxMedianAllOn.toFixed(3)}ms と閾値を超過。1パス集約の検討価値あり。`);
    reportLines.push(`- 30-05 で \`querySelectorAll('*')\` 1回 + ルール別 Map分類の PoC を作成し、削除数一致と速度改善を比較すること。`);
  }
  reportLines.push(`- jsdom 計測は参考値のため、絶対値ではなく比率と閾値判定で判断すること。実ブラウザ計測は \`page.evaluate\` で同等の \`performance.mark\` 計測を推奨。`);
  reportLines.push('');
  reportLines.push(`## 再現方法`);
  reportLines.push('');
  reportLines.push('```bash');
  reportLines.push('node scripts/benchmark-cleansing.mjs');
  reportLines.push('# またはカウント無し:');
  reportLines.push('BENCHMARK_COUNT_QSA=0 node scripts/benchmark-cleansing.mjs');
  reportLines.push('# npm スクリプト経由:');
  reportLines.push('npm run benchmark:cleansing');
  reportLines.push('```');
  reportLines.push('');
  reportLines.push(`## 計測コードの要点`);
  reportLines.push('');
  reportLines.push(`- \`performance.mark(start)\` → \`cleanseAISummaryContent\` → \`performance.mark(end)\` → \`performance.measure\` の順で計測。`);
  reportLines.push(`- 実時間は \`performance.now()\` 差分を正として採用（\`measure\` は仕様準拠の記録用に併用）。`);
  reportLines.push(`- \`querySelectorAll\` は \`Element.prototype\` / \`Document.prototype\` をラップしてカウント（環境変数で ON/OFF）。`);
  reportLines.push('');

  const outPath = resolve(projectRoot, 'dev-docs/benchmark-cleansing-2026-08-30.md');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, reportLines.join('\n') + '\n', 'utf8');

  console.log(`[benchmark-cleansing] Report written to ${outPath}`);
  console.log(`[benchmark-cleansing] Verdict: ${verdict} (max median AllON ${maxMedianAllOn.toFixed(3)}ms)`);
  for (const r of results) {
    console.log(`  size=${r.size} AllON median=${median(r.timingsAllOn).toFixed(3)}ms qsa_median=${median(r.qsaAllOn)} removed_median=${median(r.removedAllOn)} | Default median=${median(r.timingsDefault).toFixed(3)}ms qsa_median=${median(r.qsaDefault)} removed_median=${median(r.removedDefault)}`);
  }
}

await main();
