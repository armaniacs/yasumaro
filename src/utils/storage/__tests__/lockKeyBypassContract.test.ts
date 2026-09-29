/**
 * lockKeyBypassContract.test.ts
 *
 * Contract (ADR 2026-09-26-withlock-object-conflict-policy, R2): the only
 * durable conflict signal for an object lock key is its `<key>_version`
 * counter, so no production writer may replace an object lock key without
 * bumping that counter. A direct `chrome.storage.local.set` on a lock key is
 * invisible to the CAS verify read (`performCasUpdate` compares versions and
 * skips objects), so any such call site silently reintroduces the lost update
 * the lock exists to prevent.
 *
 * This suite is a source scan rather than a runtime spy on purpose: a
 * non-locking writer is by definition not reachable from the paths the
 * behavioural suites drive, so only a static scan sees call sites that no
 * test happens to exercise.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * The object lock keys under `withLock`/`withOptimisticLock`, plus the constant
 * spellings that appear in a payload as a computed key (`[PENDING_PAGES_KEY]`
 * would otherwise hide behind an identifier). `coversEveryLockKey` below fails
 * when a new lock key is added without listing it here, so the bypass scan can
 * never silently stop covering one.
 */
const LOCK_KEYS: ReadonlyArray<{ key: string; aliases: readonly string[] }> = [
  { key: 'settings', aliases: ['StorageKeys.SETTINGS'] },
  { key: 'savedUrls', aliases: ['StorageKeys.SAVED_URLS'] },
  { key: 'savedUrlsWithTimestamps', aliases: ['StorageKeys.SAVED_URLS_WITH_TIMESTAMPS'] },
  { key: 'pending_pages', aliases: ['PENDING_PAGES_KEY', 'StorageKeys.PENDING_PAGES'] },
  { key: 'denied_domains', aliases: ['StorageKeys.DENIED_DOMAINS'] },
  { key: 'trust_db', aliases: ['StorageKeys.TRUST_DB'] },
  { key: 'recording_recovery_claims', aliases: ['CLAIMS_KEY'] },
  { key: 'local_md_export_download_ids', aliases: ['LOCAL_EXPORT_DOWNLOAD_IDS_KEY'] },
  { key: 'cleansing_feedback_queue', aliases: ['StorageKeys.CLEANSING_FEEDBACK_QUEUE', 'QUEUE_KEY'] },
];

const SOURCE_ROOTS = ['src', 'entrypoints'];
const SKIPPED_DIRS = new Set(['__tests__', 'node_modules', 'dist', '.kilo', '.claude', 'bench']);

const projectRoot = resolve(import.meta.dirname, '../../../..');

function collectSourceFiles(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
}

/** Slice the balanced-paren argument that follows `openIdx` (which is the `(`). */
function extractArgument(source: string, openIdx: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (quote !== null) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return source.slice(openIdx + 1, i);
  }
  return source.slice(openIdx + 1);
}

interface Bypass {
  file: string;
  key: string;
  line: number;
}

/** The lock helper's own definition site, not a call that locks a key. */
const LOCK_HELPER_FILE = 'src/utils/storage/storageTransaction.ts';

const LOCK_CALL = /(?:^|[^\w.])(?:withOptimisticLock|withLock|withAtomic)\s*</g;

/**
 * Every key the production code passes to the object lock helpers, resolved to
 * the underlying string. Returns the raw token when it cannot be resolved, so
 * an unresolvable call site is visible in the failure output instead of being
 * silently skipped.
 */
function discoverLockKeys(): string[] {
  const files: string[] = [];
  for (const root of SOURCE_ROOTS) collectSourceFiles(join(projectRoot, root), files);
  const found = new Set<string>();
  for (const file of files) {
    if (relative(projectRoot, file) === LOCK_HELPER_FILE) continue;
    const source = readFileSync(file, 'utf8');
    // Module-level `const NAME = 'literal'` / `= 'literal' as const`, and the
    // `= StorageKeys.X` spelling the inventory also aliases.
    const constLiterals = new Map<string, string>();
    for (const m of source.matchAll(/(?:const|let)\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*['"]([^'"]+)['"]/g)) {
      constLiterals.set(m[1]!, m[2]!);
    }
    for (const m of source.matchAll(/(?:const|let)\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*(StorageKeys\.[A-Z0-9_]+)\s*;/g)) {
      constLiterals.set(m[1]!, m[2]!);
    }
    for (const m of source.matchAll(LOCK_CALL)) {
      const openIdx = source.indexOf('(', m.index + m[0].length - 1);
      if (openIdx === -1) continue;
      const args = extractArgument(source, openIdx);
      const token = /^\s*([A-Za-z_$][\w$.]*|['"][^'"]+['"])/.exec(args)?.[1];
      if (token === undefined) continue;
      if (token.startsWith("'") || token.startsWith('"')) {
        found.add(token.slice(1, -1));
        continue;
      }
      const bare = token.split('.').pop()!;
      found.add(constLiterals.get(bare) ?? token);
    }
  }
  return [...found].sort();
}

function findBypasses(): Bypass[] {
  const files: string[] = [];
  for (const root of SOURCE_ROOTS) collectSourceFiles(join(projectRoot, root), files);

  const bypasses: Bypass[] = [];
  const callNeedle = 'chrome.storage.local.set(';
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (let idx = source.indexOf(callNeedle); idx !== -1; idx = source.indexOf(callNeedle, idx + 1)) {
      const openIdx = idx + callNeedle.length - 1;
      const payload = extractArgument(source, openIdx);
      for (const { key, aliases } of LOCK_KEYS) {
        const referenced =
          new RegExp(`['"\`]${key}['"\`]`).test(payload) ||
          new RegExp(`\\b${key}\\s*:`).test(payload) ||
          aliases.some((alias) => new RegExp(`\\[\\s*${alias.replace('.', '\\.')}\\s*\\]`).test(payload));
        if (!referenced) continue;
        // A version companion in the same payload means the writer participates
        // in the CAS even if it bypasses the helper.
        if (payload.includes(`${key}_version`)) continue;
        bypasses.push({ file: relative(projectRoot, file), key, line: source.slice(0, idx).split('\n').length });
      }
    }
  }
  return bypasses;
}

describe('R2 contract: no version-non-bumping direct write to an object lock key', () => {
  it('finds zero bypass call sites in production sources', () => {
    expect(findBypasses()).toEqual([]);
  });

  it('lists every object lock key the production code actually locks', () => {
    // The hand-written inventory is the weak point of a source-scan contract:
    // a lock key added without being listed here is simply not scanned. Resolve
    // each withLock/withOptimisticLock first argument (literal or the module
    // constant that holds it) and require the inventory to cover each one.
    const covered = new Set(LOCK_KEYS.flatMap(({ key, aliases }) => [key, ...aliases]));
    const uncovered = discoverLockKeys().filter((key) => !covered.has(key));
    expect(uncovered).toEqual([]);
  });

  it('still detects a bypass when one is reintroduced', () => {
    // The scan is only a contract if it can fail: re-run it against a source
    // string that reproduces the shape that used to live in
    // pendingStorage.ts and savedUrlRepository.ts.
    const source = "await chrome.storage.local.set({ [PENDING_PAGES_KEY]: mergedPages });";
    const openIdx = source.indexOf('(');
    const payload = extractArgument(source, openIdx);
    const { key, aliases } = LOCK_KEYS[3]!;
    const referenced =
      new RegExp(`['"\`]${key}['"\`]`).test(payload) ||
      new RegExp(`\\b${key}\\s*:`).test(payload) ||
      aliases.some((alias) => new RegExp(`\\[\\s*${alias.replace('.', '\\.')}\\s*\\]`).test(payload));

    expect(referenced).toBe(true);
    expect(payload.includes(`${key}_version`)).toBe(false);
  });
});
