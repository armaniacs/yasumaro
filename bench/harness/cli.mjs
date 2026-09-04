#!/usr/bin/env node
/**
 * cli.mjs — micro-benchmark entry point.
 *
 *   node bench/harness/cli.mjs micro                     run all, write a report
 *   node bench/harness/cli.mjs micro --filter c2,c7      run a subset
 *   node bench/harness/cli.mjs micro --check             compare to baseline, exit 1 on regression
 *   node bench/harness/cli.mjs micro --update-baseline   overwrite the baseline JSON
 *   node bench/harness/cli.mjs micro --quick             warmup 2 / measure 5 (smoke)
 *
 * Run with `node --expose-gc` for heap-delta stability.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bench, flattenMetrics } from './runner.mjs';
import { compareToBaseline, renderMarkdown } from './report.mjs';
import { renderHtml } from './htmlReport.mjs';
import { pruneReports } from './clean.mjs';
import { shouldAutoOpen, openInBrowser } from './openReport.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const benchRoot = resolve(__dirname, '..');
const microDir = resolve(benchRoot, 'micro');
const baselineDir = resolve(benchRoot, 'baselines');
const reportsDir = resolve(benchRoot, 'reports');

function parseArgs(argv) {
  const [, , mode, ...rest] = argv;
  const opts = { mode: mode ?? 'micro', filter: null, check: false, updateBaseline: false, quick: false, noOpen: false };
  for (const arg of rest) {
    if (arg === '--check') opts.check = true;
    else if (arg === '--update-baseline') opts.updateBaseline = true;
    else if (arg === '--quick') opts.quick = true;
    else if (arg === '--no-open') opts.noOpen = true;
    else if (arg.startsWith('--filter=')) opts.filter = arg.slice('--filter='.length).split(',');
    else if (arg === '--filter') opts.filter = 'NEXT';
    else if (opts.filter === 'NEXT') opts.filter = arg.split(',');
  }
  return opts;
}

async function loadDefinitions(filter) {
  const files = readdirSync(microDir).filter((f) => f.endsWith('.bench.mjs'));
  const defs = [];
  for (const file of files) {
    const mod = await import(resolve(microDir, file));
    for (const key of Object.keys(mod)) {
      const d = mod[key];
      if (d && typeof d === 'object' && typeof d.id === 'string' && typeof d.run === 'function') {
        defs.push(d);
      }
    }
  }
  defs.sort((a, b) => a.id.localeCompare(b.id));
  if (!filter) return defs;
  const wanted = new Set(filter.map((s) => s.trim()));
  return defs.filter((d) => wanted.has(d.id) || [...wanted].some((w) => d.id.startsWith(w)));
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.mode !== 'micro') {
    console.error(`Unknown mode "${opts.mode}". Only "micro" is supported here; e2e benches run via Playwright.`);
    process.exit(2);
  }

  const defs = await loadDefinitions(opts.filter);
  if (defs.length === 0) {
    console.error('No matching benches.');
    process.exit(2);
  }

  const overrides = opts.quick ? { warmup: 2, measure: 5 } : {};
  const results = [];

  // Silence library logging (the structured logger writes to console) so the
  // bench progress lines stay readable. Errors still surface.
  const realConsole = { log: console.log, info: console.info, debug: console.debug, warn: console.warn };
  const mute = () => {
    console.log = console.info = console.debug = console.warn = () => {};
  };
  const unmute = () => Object.assign(console, realConsole);

  for (const def of defs) {
    process.stderr.write(`[bench] ${def.id} ... `);
    mute();
    let result;
    try {
      result = await bench(def.id, { ...def, ...overrides });
    } finally {
      unmute();
    }
    results.push(result);
    process.stderr.write(
      `done (L p50 ${Number(Object.values(result.perSize).at(-1)?.wallMs.p50 ?? 0).toFixed(2)}ms, ` +
        `scaling ${Number(result.scaling.exponent).toFixed(2)})\n`,
    );
  }

  const current = {};
  for (const r of results) Object.assign(current, flattenMetrics(r));

  const baselinePath = resolve(baselineDir, 'micro.json');
  let baseline = {};
  if (existsSync(baselinePath)) {
    try {
      baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
    } catch {
      baseline = {};
    }
  }

  const comparison = compareToBaseline(current, baseline);
  const cmp = Object.keys(baseline).length ? comparison : undefined;
  const md = renderMarkdown(results, { comparison: cmp });

  mkdirSync(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const reportPath = resolve(reportsDir, `micro-${stamp}.md`);
  const htmlPath = resolve(reportsDir, `micro-${stamp}.html`);
  const jsonPath = resolve(reportsDir, `micro-${stamp}.json`);
  writeFileSync(reportPath, md, 'utf8');

  // All modes produce the same artifact set (.md/.html/.json); failures here
  // are advisory — the bench run itself already succeeded.
  try {
    writeFileSync(htmlPath, renderHtml(results, { comparison: cmp }), 'utf8');
    const payload = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      node: process.version,
      results,
      comparison: cmp ?? null,
    };
    writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    process.stderr.write(`[bench] report -> ${reportPath} (+ .html / .json)\n`);
  } catch (err) {
    process.stderr.write(`[bench] WARNING: html/json report generation failed: ${err?.message ?? err}\n`);
  }

  try {
    const deleted = pruneReports(reportsDir);
    if (deleted.length) process.stderr.write(`[bench] pruned ${deleted.length} old report file(s)\n`);
  } catch (err) {
    process.stderr.write(`[bench] WARNING: report pruning failed: ${err?.message ?? err}\n`);
  }

  if (shouldAutoOpen({ noOpen: opts.noOpen, ci: process.env.CI, stdoutIsTTY: Boolean(process.stdout.isTTY) })) {
    if (!openInBrowser(htmlPath)) {
      process.stderr.write('[bench] could not open the HTML report automatically.\n');
    }
  }

  if (opts.updateBaseline) {
    mkdirSync(baselineDir, { recursive: true });
    writeFileSync(baselinePath, JSON.stringify(sortKeys(current), null, 2) + '\n', 'utf8');
    process.stderr.write(`[bench] baseline updated -> ${baselinePath}\n`);
    return;
  }

  if (opts.check) {
    if (!Object.keys(baseline).length) {
      console.error('[bench] --check requested but no baseline exists. Run --update-baseline first.');
      process.exit(2);
    }
    const regressions = comparison.rows.filter((r) => r.status === 'regressed');
    if (regressions.length) {
      console.error(`[bench] REGRESSION: ${regressions.length} gated metric(s) exceeded tolerance:`);
      for (const r of regressions) {
        const d = Number.isFinite(r.deltaPct) ? `+${r.deltaPct.toFixed(1)}%` : 'n/a';
        console.error(`  ${r.metric}: ${r.baseline} -> ${r.current} (${d})`);
      }
      process.exitCode = 1;
      return;
    }
    process.stderr.write('[bench] check passed — no regressions beyond tolerance.\n');
  }
}

function sortKeys(obj) {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
