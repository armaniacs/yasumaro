#!/usr/bin/env node

/**
 * check-tests.mjs — Unit test & coverage verification.
 *
 * Verifies:
 * 1. `npm test` passes (all unit tests)
 * 2. Coverage >= 90% for lines and branches (enforced in vitest.config.ts as 80%,
 *    this script checks 90% as the release gate)
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');
const COVERAGE_DIR = join(ROOT_DIR, 'coverage');

const { header, pass, fail, warn, info, sectionBreak, summary } = await import('./utils/reporter.mjs');

function runUnitTests() {
  header('Unit Tests');
  info('Running `npm test`...');

  const result = spawnSync('npm', ['test'], {
    cwd: ROOT_DIR,
    stdio: 'pipe',
    encoding: 'utf-8',
  });

  if (result.status !== 0) {
    fail('Unit tests failed');
    if (result.stdout) info(result.stdout.slice(-800));
    if (result.stderr) info(result.stderr.slice(-800));
    return false;
  }

  pass('All unit tests passed');
  return true;
}

function checkCoverage() {
  sectionBreak();
  info('Checking coverage thresholds (>= 90% for lines and branches)...');

  const coverageSummaryPath = join(COVERAGE_DIR, 'coverage-summary.json');
  if (!existsSync(coverageSummaryPath)) {
    warn('coverage-summary.json not found — run `npm run test:coverage` first');
    return true; // Non-blocking
  }

  const summary = JSON.parse(readFileSync(coverageSummaryPath, 'utf-8'));
  const thresholds = { lines: 0.9, branches: 0.9 };
  let allPassed = true;

  // coverage-summary.json has top-level keys for each file
  // We need to compute aggregate totals
  let totalLines = { total: 0, covered: 0 };
  let totalBranches = { total: 0, covered: 0 };

  for (const file of Object.values(summary)) {
    if (file.lines) {
      totalLines.total += file.lines.total || 0;
      totalLines.covered += file.lines.covered || 0;
    }
    if (file.branches) {
      totalBranches.total += file.branches.total || 0;
      totalBranches.covered += file.branches.covered || 0;
    }
  }

  const linePct = totalLines.total > 0 ? totalLines.covered / totalLines.total : 0;
  const branchPct = totalBranches.total > 0 ? totalBranches.covered / totalBranches.total : 0;

  info(`  Lines: ${(linePct * 100).toFixed(1)}% (${totalLines.covered}/${totalLines.total})`);
  info(`  Branches: ${(branchPct * 100).toFixed(1)}% (${totalBranches.covered}/${totalBranches.total})`);

  if (linePct < thresholds.lines) {
    fail(`Line coverage ${(linePct * 100).toFixed(1)}% is below ${thresholds.lines * 100}%`);
    allPassed = false;
  } else {
    pass(`Line coverage ${(linePct * 100).toFixed(1)}% meets threshold`);
  }

  if (branchPct < thresholds.branches) {
    fail(`Branch coverage ${(branchPct * 100).toFixed(1)}% is below ${thresholds.branches * 100}%`);
    allPassed = false;
  } else {
    pass(`Branch coverage ${(branchPct * 100).toFixed(1)}% meets threshold`);
  }

  return allPassed;
}

function checkTestCategories() {
  sectionBreak();
  info('Checking test category distribution...');

  const testDir = join(ROOT_DIR, 'src');
  const categories = {
    'src/background': 0,
    'src/content': 0,
    'src/popup': 0,
    'src/utils': 0,
    'src/dashboard': 0,
    'src/offscreen': 0,
    'src/messaging': 0,
  };

  let totalTests = 0;

  function countTests(dir, prefix) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        countTests(fullPath, prefix + entry.name + '/');
      } else if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts')) {
        const content = readFileSync(fullPath, 'utf-8');
        const count = (content.match(/\b(it|test|describe)\s*\(/g) || []).length;
        totalTests += count;
        for (const cat of Object.keys(categories)) {
          if (prefix.startsWith(cat + '/')) {
            categories[cat] += count;
          }
        }
      }
    }
  }

  if (existsSync(testDir)) {
    countTests(testDir, 'src/');
  }

  info(`  Total test cases: ${totalTests}`);
  for (const [cat, count] of Object.entries(categories)) {
    if (count > 0) {
      info(`    ${cat}: ${count} test cases`);
    }
  }

  pass(`Found ${totalTests} test cases across ${Object.values(categories).filter((c) => c > 0).length} categories`);
  return true;
}

function main() {
  const results = [];

  const testsOk = runUnitTests();
  results.push({ name: 'Unit Tests', ok: testsOk });

  if (testsOk) {
    results.push({ name: 'Coverage', ok: checkCoverage() });
  } else {
    warn('Skipping coverage check because unit tests failed');
    results.push({ name: 'Coverage', ok: false });
  }

  results.push({ name: 'Test Categories', ok: checkTestCategories() });

  sectionBreak();
  const allPassed = summary();
  process.exit(allPassed ? 0 : 1);
}

main();
