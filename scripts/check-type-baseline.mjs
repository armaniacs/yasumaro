#!/usr/bin/env node
/**
 * type-check baseline gate (PBI 2026-09-07-04)
 *
 * `tsc --project testDir/tsconfig.json` currently reports a fixed number of
 * pre-existing type errors in test files that were never type-checked
 * (baseline: testDir/type-check-baseline.json). This gate fails when any file
 * introduces NEW type errors or exceeds its baseline count, while keeping the
 * existing debt tracked in the baseline until the payoff PBI retires it.
 *
 * - exit 0: error count per file is at or below baseline
 * - exit 1: any file exceeds its baseline, or a file not in the baseline has errors
 * - fixes that lower the count print a hint to regenerate the baseline
 */

import { execFileSync } from 'child_process';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(ROOT, 'testDir/type-check-baseline.json');
const TSC_ARGS = ['--project', 'testDir/tsconfig.json', '--noEmit', '--pretty', 'false'];

let tscOutput;
try {
  tscOutput = execFileSync('npx', ['tsc', ...TSC_ARGS], {
    cwd: ROOT,
    encoding: 'utf-8',
    maxBuffer: 256 * 1024 * 1024,
  });
} catch (err) {
  // tsc exits non-zero when errors exist — stdout still carries the report
  tscOutput = String(err.stdout ?? '');
  if (!tscOutput) {
    console.error('type-check baseline: tsc produced no output', err.message);
    process.exit(1);
  }
}

/** Collect error counts per file: { "src/.../file.test.ts": 12, ... } */
function collectErrors(output) {
  const counts = new Map();
  for (const line of output.split('\n')) {
    const m = line.match(/^(.+?)\(\d+,\d+\): error TS\d+:/);
    if (!m) continue;
    const rel = relative(ROOT, m[1]).split('\\').join('/');
    counts.set(rel, (counts.get(rel) ?? 0) + 1);
  }
  return counts;
}

const current = collectErrors(tscOutput);
const total = [...current.values()].reduce((a, b) => a + b, 0);

if (!existsSync(BASELINE_PATH)) {
  const baseline = { total, files: Object.fromEntries([...current.entries()].sort()) };
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n');
  console.log(`type-check baseline: created with ${total} errors in ${current.size} files.`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));
const baselineFiles = baseline.files ?? {};

const regressions = [];
for (const [file, count] of current) {
  const allowed = baselineFiles[file];
  if (allowed === undefined) {
    regressions.push(`  NEW FILE ${file}: ${count} errors (not in baseline)`);
  } else if (count > allowed) {
    regressions.push(`  ${file}: ${count} errors (baseline ${allowed}, +${count - allowed})`);
  }
}

if (regressions.length > 0) {
  console.error(`type-check baseline: type errors increased in ${regressions.length} file(s). Fix or update testDir/type-check-baseline.json deliberately.`);
  console.error(regressions.join('\n'));
  process.exit(1);
}

const fixed = Object.entries(baselineFiles)
  .filter(([file, allowed]) => (current.get(file) ?? 0) < allowed)
  .map(([file, allowed]) => `  ${file}: ${allowed} → ${current.get(file) ?? 0}`);
if (fixed.length > 0) {
  console.log(`type-check baseline: ${fixed.length} file(s) improved. Update testDir/type-check-baseline.json (e.g. npm run type-check:test:baseline):`);
  console.error(fixed.slice(0, 10).join('\n'));
}
console.log(`type-check baseline: OK (${total} known errors, at or below baseline).`);
