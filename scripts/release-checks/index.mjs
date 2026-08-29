#!/usr/bin/env node

/**
 * index.mjs — Release check orchestrator.
 *
 * Runs all release checks and reports a unified summary.
 *
 * Usage:
 *   node scripts/release-checks/index.mjs [--skip-e2e] [--category <name>]
 *
 * Categories:
 *   build       — Build artifacts, bundle size, no eval
 *   deps        — npm audit, licenses, outdated deps
 *   docs        — README/docs links, version consistency, CHANGELOG
 *   tests       — Unit tests + coverage
 *   e2e         — Playwright E2E tests
 *   metadata    — Version consistency, git tag, git clean
 *   manifest    — Manifest V3 compliance, permissions, CSP
 *   i18n        — Translation completeness
 *   all         — All checks (default)
 */

import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');

const CHECK_SCRIPTS = {
  build: 'scripts/release-checks/check-build.mjs',
  deps: 'scripts/release-checks/check-deps.mjs',
  docs: 'scripts/release-checks/check-docs.mjs',
  tests: 'scripts/release-checks/check-tests.mjs',
  e2e: 'scripts/release-checks/check-e2e.mjs',
  metadata: 'scripts/release-checks/check-release-metadata.mjs',
  manifest: 'scripts/release-checks/check-manifest.mjs',
  i18n: 'scripts/release-checks/check-i18n.mjs',
};

function parseArgs() {
  const args = process.argv.slice(2);
  const skipE2E = args.includes('--skip-e2e');
  const categoryArg = args.find((a) => a.startsWith('--category='));
  const category = categoryArg ? categoryArg.split('=')[1] : 'all';

  if (category !== 'all' && !CHECK_SCRIPTS[category]) {
    console.error(`Unknown category: ${category}`);
    console.error(`Available categories: ${Object.keys(CHECK_SCRIPTS).join(', ')}`);
    process.exit(1);
  }

  return { skipE2E, category };
}

function runCheck(name, scriptPath) {
  const result = spawnSync('node', [join(ROOT_DIR, scriptPath)], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    encoding: 'utf-8',
  });

  return result.status === 0;
}

function main() {
  const { skipE2E, category } = parseArgs();

  console.log('\n╔═══════════════════════════════════════════════╗');
  console.log('║        Yasumaro Release Checks                ║');
  console.log('╚═══════════════════════════════════════════════╝');

  const categories = category === 'all' ? Object.keys(CHECK_SCRIPTS) : [category];
  const results = {};

  for (const cat of categories) {
    if (skipE2E && cat === 'e2e') {
      console.log(`\n⏭️  Skipping E2E tests (--skip-e2e)`);
      continue;
    }

    const script = CHECK_SCRIPTS[cat];
    console.log(`\n▶ Running: ${cat}`);
    const ok = runCheck(cat, script);
    results[cat] = ok;
  }

  // Summary
  console.log('\n╔═══════════════════════════════════════════════╗');
  console.log('║           Release Check Summary               ║');
  console.log('╚═══════════════════════════════════════════════╝');

  let passCount = 0;
  let failCount = 0;

  for (const [cat, ok] of Object.entries(results)) {
    const icon = ok ? '✅' : '❌';
    const status = ok ? 'PASS' : 'FAIL';
    console.log(`  ${icon} ${cat.padEnd(12)} ${status}`);
    if (ok) passCount++;
    else failCount++;
  }

  console.log(`\n  Total: ${passCount} passed, ${failCount} failed`);

  if (failCount > 0) {
    console.log('\n❌ Release checks FAILED — fix issues before releasing');
    process.exit(1);
  }

  console.log('\n✅ All release checks PASSED — ready to release');
  process.exit(0);
}

main();
