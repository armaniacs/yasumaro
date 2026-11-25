#!/usr/bin/env node

/**
 * check-dependings.mjs — DEPENDINGS.md freshness verification.
 *
 * Fails the release gate when the machine-derived numbers in
 * `docs/DEPENDINGS.md` (§1 tables, lockfile counts, THIRD_PARTY_NOTICES count,
 * header date) drift from `package.json` / `package-lock.json` /
 * `THIRD_PARTY_NOTICES.md`. The §5 verdict and §6 risk-acceptance records are
 * manual and are not inspected here; audit memo coverage stays in
 * `check-deps.mjs`.
 *
 * Pure helpers are exported for unit tests. I/O lives in main() only.
 */

import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');

const { header, pass, fail, warn, info, sectionBreak, summary } = await import('./utils/reporter.mjs');

const DEPENDINGS_PATH = join(ROOT_DIR, 'docs', 'DEPENDINGS.md');
const PKG_PATH = join(ROOT_DIR, 'package.json');
const LOCK_PATH = join(ROOT_DIR, 'package-lock.json');
const NOTICES_PATH = join(ROOT_DIR, 'THIRD_PARTY_NOTICES.md');

const STALE_WARN_DAYS = 7;
const STALE_FAIL_DAYS = 30;

export function parseRuntimeTable(text) {
  const rows = new Map();
  const rowPattern = /^\| `([^`]+)` \| ([^|]+?) \| ([^|]+?) \|/gm;
  let m;
  while ((m = rowPattern.exec(text)) !== null) {
    const name = m[1].trim();
    if (name === 'パッケージ') continue;
    rows.set(name, { required: m[2].trim(), installed: m[3].trim() });
  }
  return rows;
}

export function parseDevGroupVersions(text) {
  const versions = new Map();
  const pattern = /`([^`]+)` \((\d+\.\d+\.\d+[^)]*)\)/g;
  let m;
  while ((m = pattern.exec(text)) !== null) versions.set(m[1], m[2]);
  return versions;
}

export function parseCounts(text) {
  const dev = text.match(/^- 開発依存: (\d+) 件/m);
  const lock = text.match(/^- lockfile 上のパッケージ総数: (\d+)（うち `node_modules`[^0-9]*?(\d+)）/m);
  const runtime = text.match(/^- ランタイム依存（配布物に同梱）: (\d+) 件のみ/m);
  return {
    devDeps: dev ? Number(dev[1]) : null,
    lockTotal: lock ? Number(lock[1]) : null,
    licenseTargets: lock ? Number(lock[2]) : null,
    runtimeCount: runtime ? Number(runtime[1]) : null,
  };
}

export function parseFinalCheckDate(text) {
  const m = text.match(/^- 最終確認日: (\d{4}-\d{2}-\d{2})/m);
  return m ? m[1] : null;
}

export function parseNoticesCount(text) {
  const m = text.match(/automatically generated for (\d+) package\(s\)/);
  return m ? Number(m[1]) : null;
}

export function parseDocNoticesCount(text) {
  const m = text.match(/最終生成は \d{4}-\d{2}-\d{2}（(\d+) パッケージ分）/);
  return m ? Number(m[1]) : null;
}

export function compareRuntime(docRows, pkgDeps, lockPackages) {
  const mismatches = [];
  for (const [name, required] of Object.entries(pkgDeps)) {
    const row = docRows.get(name);
    const installed = lockPackages[`node_modules/${name}`]?.version ?? null;
    if (!row) {
      mismatches.push(`${name}: missing row in DEPENDINGS.md runtime table`);
      continue;
    }
    if (row.required !== required) mismatches.push(`${name}: required ${row.required} != package.json ${required}`);
    if (installed && row.installed !== installed) {
      mismatches.push(`${name}: installed ${row.installed} != lockfile ${installed}`);
    }
  }
  return mismatches;
}

export function compareDevVersions(docVersions, lockPackages, aliases = {}) {
  const mismatches = [];
  for (const [docName, docVersion] of docVersions) {
    const lockName = aliases[docName] ?? docName;
    const locked = lockPackages[`node_modules/${lockName}`]?.version;
    if (!locked) continue;
    if (locked !== docVersion) mismatches.push(`${docName}: doc ${docVersion} != lockfile ${locked}`);
  }
  return mismatches;
}

export function compareCounts(docCounts, actual) {
  const mismatches = [];
  if (docCounts.devDeps !== null && docCounts.devDeps !== actual.devDeps) {
    mismatches.push(`devDeps: doc ${docCounts.devDeps} != package.json ${actual.devDeps}`);
  }
  if (docCounts.lockTotal !== null && docCounts.lockTotal !== actual.lockTotal) {
    mismatches.push(`lockTotal: doc ${docCounts.lockTotal} != lockfile ${actual.lockTotal}`);
  }
  if (docCounts.licenseTargets !== null && docCounts.licenseTargets !== actual.noticesCount) {
    mismatches.push(`licenseTargets: doc ${docCounts.licenseTargets} != THIRD_PARTY_NOTICES ${actual.noticesCount}`);
  }
  if (docCounts.runtimeCount !== null && docCounts.runtimeCount !== actual.runtimeCount) {
    mismatches.push(`runtimeCount: doc ${docCounts.runtimeCount} != package.json ${actual.runtimeCount}`);
  }
  if (actual.docNoticesCount !== null && actual.docNoticesCount !== actual.noticesCount) {
    mismatches.push(`notices: doc says ${actual.docNoticesCount} != THIRD_PARTY_NOTICES ${actual.noticesCount}`);
  }
  return mismatches;
}

export function decideDateFreshness(docDate, nowDate, docMtimeMs, lockMtimeMs) {
  if (!docDate) return { status: 'missing' };
  if (lockMtimeMs > docMtimeMs) {
    return { status: 'stale', reason: 'package-lock.json is newer than docs/DEPENDINGS.md' };
  }
  const days = Math.floor((nowDate.getTime() - new Date(`${docDate}T00:00:00`).getTime()) / 86400000);
  if (days < 0) return { status: 'stale', reason: 'final check date is in the future' };
  if (days > STALE_FAIL_DAYS) return { status: 'stale', reason: `final check date is ${days} days old` };
  if (days > STALE_WARN_DAYS) return { status: 'warn', reason: `final check date is ${days} days old` };
  return { status: 'fresh' };
}

function collectInputs() {
  const doc = readFileSync(DEPENDINGS_PATH, 'utf-8');
  const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf-8'));
  const lock = JSON.parse(readFileSync(LOCK_PATH, 'utf-8'));
  const notices = readFileSync(NOTICES_PATH, 'utf-8');
  const docMtimeMs = statSync(DEPENDINGS_PATH).mtimeMs;
  const lockMtimeMs = statSync(LOCK_PATH).mtimeMs;
  return { doc, pkg, lock, notices, docMtimeMs, lockMtimeMs };
}

function main() {
  header('DEPENDINGS.md freshness');
  let inputs;
  try {
    inputs = collectInputs();
  } catch (e) {
    fail(`Could not read inputs: ${e.message}`);
    sectionBreak();
    process.exit(summary() ? 0 : 1);
  }

  const { doc, pkg, lock, notices, docMtimeMs, lockMtimeMs } = inputs;
  const lockPackages = lock.packages ?? {};
  const pkgDeps = pkg.dependencies ?? {};
  const actual = {
    devDeps: Object.keys(pkg.devDependencies ?? {}).length,
    lockTotal: Object.keys(lockPackages).filter((k) => k !== '').length,
    noticesCount: parseNoticesCount(notices),
    docNoticesCount: parseDocNoticesCount(doc),
    runtimeCount: Object.keys(pkgDeps).length,
  };

  const runtimeMismatches = compareRuntime(parseRuntimeTable(doc), pkgDeps, lockPackages);
  const devMismatches = compareDevVersions(parseDevGroupVersions(doc), lockPackages, {
    'vitest-runner': '@stryker-mutator/vitest-runner',
  });
  const countMismatches = compareCounts(parseCounts(doc), actual);
  const freshness = decideDateFreshness(parseFinalCheckDate(doc), new Date(), docMtimeMs, lockMtimeMs);

  if (runtimeMismatches.length === 0) pass('Runtime table matches package.json and lockfile');
  else {
    fail(`${runtimeMismatches.length} runtime table mismatch(es)`);
    for (const m of runtimeMismatches) info(`  ${m}`);
  }

  sectionBreak();
  if (devMismatches.length === 0) pass('Dev-group versions match lockfile');
  else {
    fail(`${devMismatches.length} dev-group version mismatch(es)`);
    for (const m of devMismatches.slice(0, 20)) info(`  ${m}`);
    if (devMismatches.length > 20) info(`  … and ${devMismatches.length - 20} more`);
  }

  sectionBreak();
  if (countMismatches.length === 0) pass('Dependency counts match');
  else {
    fail(`${countMismatches.length} count mismatch(es)`);
    for (const m of countMismatches) info(`  ${m}`);
  }

  sectionBreak();
  if (freshness.status === 'fresh') pass('Final check date is fresh');
  else if (freshness.status === 'warn') warn(`DEPENDINGS.md is getting old: ${freshness.reason}`);
  else fail(`DEPENDINGS.md is stale: ${freshness.reason ?? 'missing date'} — run \`npm run generate:dependings\``);

  sectionBreak();
  process.exit(summary() ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (e) {
    fail(`Dependings check could not complete: ${e.message}`);
    process.exit(1);
  }
}
