/**
 * dependingsCommon.mjs — Shared knowledge for the DEPENDINGS.md tooling.
 *
 * generate-dependings.mjs (writer) and check-dependings.mjs (release gate)
 * used to keep separate copies of the document paths, the section line
 * formats and the lockfile counting rules; this module is the single source
 * for that knowledge so a template change cannot silently desynchronize the
 * writer from the parser.
 */

import { join, dirname } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const ROOT_DIR = join(__dirname, '..');

export const DEPENDINGS_PATH = join(ROOT_DIR, 'docs', 'DEPENDINGS.md');
export const PKG_PATH = join(ROOT_DIR, 'package.json');
export const LOCK_PATH = join(ROOT_DIR, 'package-lock.json');
export const NOTICES_PATH = join(ROOT_DIR, 'THIRD_PARTY_NOTICES.md');

// Section line formats. Capture groups carry the parsed value; generate uses
// the same patterns to locate the lines it rewrites. Non-global on purpose:
// a shared /g regex object would leak lastIndex between callers.
export const FINAL_CHECK_DATE_PATTERN = /^- 最終確認日: (\d{4}-\d{2}-\d{2})/m;
export const RUNTIME_COUNT_PATTERN = /^- ランタイム依存（配布物に同梱）: (\d+) 件のみ/m;
export const DEV_DEPS_PATTERN = /^- 開発依存: (\d+) 件/m;

// The lockfile-counts line exists in two forms: the canonical text generate
// writes (strict, fails loudly on a rephrased doc) and a tolerant variant the
// release gate parses so hand-edited wording still gets compared.
export const LOCK_COUNTS_LINE_PATTERN = /^- lockfile 上のパッケージ総数: (\d+)（うち `node_modules` に実インストールされてライセンス走査の対象になるのは (\d+)）/m;
export const LOCK_COUNTS_TOLERANT_PATTERN = /^- lockfile 上のパッケージ総数: (\d+)（うち `node_modules`[^0-9]*?(\d+)）/m;

// The dev-group table abbreviates the stryker runner as `vitest-runner`;
// the lockfile only knows it by its full scoped name.
export const DOC_TO_LOCK_ALIAS = { 'vitest-runner': '@stryker-mutator/vitest-runner' };

// Fresh regex per call: callers exec/replace with it, and a shared /g object
// would carry lastIndex across invocations.
export function createDevVersionsPattern() {
  return /`([^`]+)` \((\d+\.\d+\.\d+[^)]*)\)/g;
}

export function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function daysSince(dateStr, nowDate) {
  return Math.floor((nowDate.getTime() - new Date(`${dateStr}T00:00:00`).getTime()) / 86400000);
}

export function lockVersion(packages, name) {
  return packages[`node_modules/${name}`]?.version ?? null;
}

export function countLockPackages(packages) {
  return Object.keys(packages).filter((k) => k !== '').length;
}

export function parseNoticesCount(text) {
  const m = text.match(/automatically generated for (\d+) package\(s\)/);
  return m ? Number(m[1]) : null;
}

/**
 * True when the module behind entryUrl is the node entry script. Compares
 * real paths: argv[1] may reach the script through a symlinked directory
 * (e.g. macOS /var vs /private/var), where a naive
 * `import.meta.url === \`file://${argv[1]}\`` comparison silently mismatches
 * and the CLI would no-op.
 */
export function isDirectInvocation(entryUrl, argvPath = process.argv[1]) {
  if (!argvPath) return false;
  try {
    return entryUrl === pathToFileURL(realpathSync(argvPath)).href;
  } catch {
    return false;
  }
}
