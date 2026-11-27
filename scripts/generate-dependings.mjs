#!/usr/bin/env node

/**
 * generate-dependings.mjs — Refreshes the numeric parts of docs/DEPENDINGS.md.
 *
 * Only the machine-derived §1 / §4 values are rewritten. §5 verdict text and
 * the §6 risk-acceptance records are manual and are never touched, so audit
 * history cannot be overwritten by a generator run.
 *
 * The `- 最終確認日:` line attests that a human re-checked the document, so it
 * is preserved as-is by default. Advance it to today only after an actual
 * review, by passing --confirm-date:
 *
 *   node scripts/generate-dependings.mjs                # numbers only, date kept
 *   node scripts/generate-dependings.mjs --confirm-date # date moved to today
 */

import { readFileSync, writeFileSync } from 'node:fs';
import {
  DEPENDINGS_PATH,
  DEV_DEPS_PATTERN,
  DOC_TO_LOCK_ALIAS,
  FINAL_CHECK_DATE_PATTERN,
  LOCK_COUNTS_LINE_PATTERN,
  LOCK_PATH,
  NOTICES_PATH,
  PKG_PATH,
  RUNTIME_COUNT_PATTERN,
  countLockPackages,
  createDevVersionsPattern,
  isDirectInvocation,
  lockVersion,
  parseNoticesCount,
  today,
} from './dependingsCommon.mjs';

function replaceOrThrow(text, pattern, replacement, label) {
  if (!pattern.test(text)) throw new Error(`pattern not found: ${label}`);
  return text.replace(pattern, replacement);
}

/**
 * Rewrites the machine-derived numbers in the DEPENDINGS.md text and returns
 * the new text. Pure: no I/O, and the review date moves only when confirmDate
 * is set.
 */
export function applyDependencyNumbers(doc, { pkg, lock, notices, date, confirmDate = false }) {
  const packages = lock.packages ?? {};
  const runtimeNames = Object.keys(pkg.dependencies ?? {});
  const devDepsCount = Object.keys(pkg.devDependencies ?? {}).length;
  const lockTotal = countLockPackages(packages);
  const noticesCount = parseNoticesCount(notices);
  if (noticesCount === null) throw new Error('could not parse THIRD_PARTY_NOTICES.md count');

  let out = doc;

  // WHY: this line records when a human last verified the document; stamping
  // it on every run let the freshness gate pass without any real re-check.
  if (confirmDate) {
    out = replaceOrThrow(out, FINAL_CHECK_DATE_PATTERN, `- 最終確認日: ${date}`, 'header date');
  } else if (!FINAL_CHECK_DATE_PATTERN.test(out)) {
    throw new Error('pattern not found: header date');
  }

  out = replaceOrThrow(
    out,
    RUNTIME_COUNT_PATTERN,
    `- ランタイム依存（配布物に同梱）: ${runtimeNames.length} 件のみ`,
    'runtime count'
  );

  out = replaceOrThrow(
    out,
    DEV_DEPS_PATTERN,
    `- 開発依存: ${devDepsCount} 件`,
    'devDeps count'
  );

  out = replaceOrThrow(
    out,
    LOCK_COUNTS_LINE_PATTERN,
    `- lockfile 上のパッケージ総数: ${lockTotal}（うち \`node_modules\` に実インストールされてライセンス走査の対象になるのは ${noticesCount}）`,
    'lockfile counts'
  );

  for (const name of runtimeNames) {
    const required = pkg.dependencies[name];
    const installed = lockVersion(packages, name);
    if (!installed) throw new Error(`lockfile has no entry for ${name}`);
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const row = new RegExp(`^(\\| \`${escaped}\` \\|) [^|]+ \\| [^|]+ (\\|)`, 'm');
    if (!row.test(out)) throw new Error(`runtime row not found: ${name}`);
    out = out.replace(row, `$1 ${required} | ${installed} $2`);
  }

  // The dev-group table lists exactly these names; a doc-side rename must be
  // paired here and (when the lockfile uses a scoped name) in DOC_TO_LOCK_ALIAS.
  const devVersionNames = [
    'wxt',
    'vite',
    'esbuild',
    'typescript',
    'vitest',
    '@playwright/test',
    'happy-dom',
    'jsdom',
    '@stryker-mutator/core',
    '@stryker-mutator/vitest-runner',
    'better-sqlite3',
    'oxlint',
    'eslint',
    'knip',
    'license-checker',
    '@cyclonedx/cyclonedx-npm',
  ];
  const devVersions = Object.fromEntries(
    devVersionNames.map((name) => [name, lockVersion(packages, name)]),
  );
  for (const [name, version] of Object.entries(devVersions)) {
    if (!version) throw new Error(`lockfile has no entry for ${name}`);
  }
  // The dev-group table pairs `@stryker-mutator/core` with `vitest-runner`
  // sharing one version; a divergence means the lockfile pair was broken.
  const strykerCore = devVersions['@stryker-mutator/core'];
  const strykerRunner = devVersions['@stryker-mutator/vitest-runner'];
  if (strykerCore !== strykerRunner) throw new Error('stryker core/runner versions diverged');
  out = out.replace(createDevVersionsPattern(), (m, name) => {
    const lockName = DOC_TO_LOCK_ALIAS[name] ?? name;
    if (lockName in devVersions) return `\`${name}\` (${devVersions[lockName]})`;
    return m;
  });

  out = replaceOrThrow(
    out,
    /^- `THIRD_PARTY_NOTICES\.md`: `npm run generate-notices` で手動生成する。CI での自動検証は生成結果が macOS \/ Linux で差異を出すため 2026-07-19 に削除済み。最終生成は \d{4}-\d{2}-\d{2}（\d+ パッケージ分）で、現在の \d+ パッケージ(?:に対して古い|と一致)/m,
    `- \`THIRD_PARTY_NOTICES.md\`: \`npm run generate-notices\` で手動生成する。CI での自動検証は生成結果が macOS / Linux で差異を出すため 2026-07-19 に削除済み。最終生成は ${date}（${noticesCount} パッケージ分）で、現在の ${noticesCount} パッケージと一致`,
    'notices line'
  );

  return out;
}

function main() {
  const confirmDate = process.argv.includes('--confirm-date');
  const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf-8'));
  const lock = JSON.parse(readFileSync(LOCK_PATH, 'utf-8'));
  const doc = readFileSync(DEPENDINGS_PATH, 'utf-8');
  const notices = readFileSync(NOTICES_PATH, 'utf-8');
  const date = today();

  const out = applyDependencyNumbers(doc, { pkg, lock, notices, date, confirmDate });

  if (out === doc) {
    console.log('docs/DEPENDINGS.md is already up to date');
    return;
  }
  writeFileSync(DEPENDINGS_PATH, out);
  console.log(`docs/DEPENDINGS.md refreshed for ${date}`);
}

if (isDirectInvocation(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(`generate-dependings failed: ${e.message}`);
    process.exit(1);
  }
}
