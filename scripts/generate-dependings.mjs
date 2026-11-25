#!/usr/bin/env node

/**
 * generate-dependings.mjs — Refreshes the numeric parts of docs/DEPENDINGS.md.
 *
 * Only the machine-derived §1 / §4 values are rewritten. §5 verdict text and
 * the §6 risk-acceptance records are manual and are never touched, so audit
 * history cannot be overwritten by a generator run.
 *
 * Usage: node scripts/generate-dependings.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

const DEPENDINGS_PATH = join(ROOT_DIR, 'docs', 'DEPENDINGS.md');
const PKG_PATH = join(ROOT_DIR, 'package.json');
const LOCK_PATH = join(ROOT_DIR, 'package-lock.json');
const NOTICES_PATH = join(ROOT_DIR, 'THIRD_PARTY_NOTICES.md');

function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function lockVersion(packages, name) {
  return packages[`node_modules/${name}`]?.version ?? null;
}

function parseNoticesCount(text) {
  const m = text.match(/automatically generated for (\d+) package\(s\)/);
  return m ? Number(m[1]) : null;
}

function replaceOrThrow(text, pattern, replacement, label) {
  if (!pattern.test(text)) throw new Error(`pattern not found: ${label}`);
  return text.replace(pattern, replacement);
}

function main() {
  const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf-8'));
  const lock = JSON.parse(readFileSync(LOCK_PATH, 'utf-8'));
  const packages = lock.packages ?? {};
  const doc = readFileSync(DEPENDINGS_PATH, 'utf-8');
  const notices = readFileSync(NOTICES_PATH, 'utf-8');

  const date = today();
  const runtimeNames = Object.keys(pkg.dependencies ?? {});
  const devDepsCount = Object.keys(pkg.devDependencies ?? {}).length;
  const lockTotal = Object.keys(packages).filter((k) => k !== '').length;
  const noticesCount = parseNoticesCount(notices);
  if (noticesCount === null) throw new Error('could not parse THIRD_PARTY_NOTICES.md count');

  let out = doc;

  out = replaceOrThrow(
    out,
    /^- 最終確認日: \d{4}-\d{2}-\d{2}/m,
    `- 最終確認日: ${date}`,
    'header date'
  );

  out = replaceOrThrow(
    out,
    /^- ランタイム依存（配布物に同梱）: \d+ 件のみ/m,
    `- ランタイム依存（配布物に同梱）: ${runtimeNames.length} 件のみ`,
    'runtime count'
  );

  out = replaceOrThrow(
    out,
    /^- 開発依存: \d+ 件/m,
    `- 開発依存: ${devDepsCount} 件`,
    'devDeps count'
  );

  out = replaceOrThrow(
    out,
    /^- lockfile 上のパッケージ総数: \d+（うち `node_modules` に実インストールされてライセンス走査の対象になるのは \d+）/m,
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

  const devVersions = {
    wxt: lockVersion(packages, 'wxt'),
    vite: lockVersion(packages, 'vite'),
    esbuild: lockVersion(packages, 'esbuild'),
    typescript: lockVersion(packages, 'typescript'),
    vitest: lockVersion(packages, 'vitest'),
    '@playwright/test': lockVersion(packages, '@playwright/test'),
    'happy-dom': lockVersion(packages, 'happy-dom'),
    jsdom: lockVersion(packages, 'jsdom'),
    '@stryker-mutator/core': lockVersion(packages, '@stryker-mutator/core'),
    '@stryker-mutator/vitest-runner': lockVersion(packages, '@stryker-mutator/vitest-runner'),
    'better-sqlite3': lockVersion(packages, 'better-sqlite3'),
    oxlint: lockVersion(packages, 'oxlint'),
    eslint: lockVersion(packages, 'eslint'),
    knip: lockVersion(packages, 'knip'),
    'license-checker': lockVersion(packages, 'license-checker'),
    '@cyclonedx/cyclonedx-npm': lockVersion(packages, '@cyclonedx/cyclonedx-npm'),
  };
  for (const [name, version] of Object.entries(devVersions)) {
    if (!version) throw new Error(`lockfile has no entry for ${name}`);
  }
  // The dev-group table abbreviates the stryker runner as `vitest-runner`
  // and pairs it with `@stryker-mutator/core` sharing one version.
  const docToLock = { 'vitest-runner': '@stryker-mutator/vitest-runner' };
  const strykerCore = lockVersion(packages, '@stryker-mutator/core');
  const strykerRunner = lockVersion(packages, '@stryker-mutator/vitest-runner');
  if (strykerCore !== strykerRunner) throw new Error('stryker core/runner versions diverged');
  out = out.replace(/`([^`]+)` \((\d+\.\d+\.\d+[^)]*)\)/g, (m, name) => {
    const lockName = docToLock[name] ?? name;
    if (lockName in devVersions) return `\`${name}\` (${devVersions[lockName]})`;
    return m;
  });

  out = replaceOrThrow(
    out,
    /^- `THIRD_PARTY_NOTICES\.md`: `npm run generate-notices` で手動生成する。CI での自動検証は生成結果が macOS \/ Linux で差異を出すため 2026-07-19 に削除済み。最終生成は \d{4}-\d{2}-\d{2}（\d+ パッケージ分）で、現在の \d+ パッケージ(?:に対して古い|と一致)/m,
    `- \`THIRD_PARTY_NOTICES.md\`: \`npm run generate-notices\` で手動生成する。CI での自動検証は生成結果が macOS / Linux で差異を出すため 2026-07-19 に削除済み。最終生成は ${date}（${noticesCount} パッケージ分）で、現在の ${noticesCount} パッケージと一致`,
    'notices line'
  );

  if (out === doc) {
    console.log('docs/DEPENDINGS.md is already up to date');
    return;
  }
  writeFileSync(DEPENDINGS_PATH, out);
  console.log(`docs/DEPENDINGS.md refreshed for ${date}`);
}

try {
  main();
} catch (e) {
  console.error(`generate-dependings failed: ${e.message}`);
  process.exit(1);
}
