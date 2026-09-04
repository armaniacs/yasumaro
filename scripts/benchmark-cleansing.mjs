#!/usr/bin/env node
/**
 * Benchmark for aiSummaryCleaner.
 *
 * Ported onto the shared harness (bench/harness/*). The cleansing bench itself
 * now lives at bench/micro/cleansing.bench.mjs; this script keeps the old
 * `npm run benchmark:cleansing` entry point working and still writes a
 * standalone Markdown report under dev-docs/.
 *
 * For the full micro-suite (cleansing + c1-c7) use: npm run bench:micro
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bench } from '../bench/harness/runner.mjs';
import { renderMarkdown } from '../bench/harness/report.mjs';
import { definition } from '../bench/micro/cleansing.bench.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Silence the structured logger's console output.
const real = { log: console.log, info: console.info, debug: console.debug, warn: console.warn };
console.log = console.info = console.debug = console.warn = () => {};

const result = await bench(definition.id, { ...definition, warmup: 3, measure: 10 });

Object.assign(console, real);

const md = renderMarkdown([result], { title: 'Cleansing Benchmark' });
const outPath = resolve(projectRoot, `dev-docs/benchmark-cleansing-${new Date().toISOString().slice(0, 10)}.md`);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, md, 'utf8');

console.log(`[benchmark-cleansing] Report written to ${outPath}`);
for (const [sizeKey, s] of Object.entries(result.perSize)) {
  console.log(
    `  size=${s.n} p50=${s.wallMs.p50.toFixed(3)}ms p95=${s.wallMs.p95.toFixed(3)}ms ` +
      `qsa=${s.counters.qsa} treeWalker=${s.counters.treeWalker}`,
  );
}
console.log(`  scaling exponent: ${result.scaling.exponent.toFixed(3)} (${result.scaling.verdict})`);
