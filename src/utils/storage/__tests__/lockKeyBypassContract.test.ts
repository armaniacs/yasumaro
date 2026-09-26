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
 * The six object lock keys under `withLock`/`withAtomic`, plus the constant
 * spellings that appear in a payload as a computed key (`[PENDING_PAGES_KEY]`
 * would otherwise hide behind an identifier).
 */
const LOCK_KEYS: ReadonlyArray<{ key: string; aliases: readonly string[] }> = [
  { key: 'settings', aliases: ['StorageKeys.SETTINGS'] },
  { key: 'savedUrls', aliases: ['StorageKeys.SAVED_URLS'] },
  { key: 'savedUrlsWithTimestamps', aliases: ['StorageKeys.SAVED_URLS_WITH_TIMESTAMPS'] },
  { key: 'pending_pages', aliases: ['PENDING_PAGES_KEY', 'StorageKeys.PENDING_PAGES'] },
  { key: 'denied_domains', aliases: ['StorageKeys.DENIED_DOMAINS'] },
  { key: 'trust_db', aliases: ['StorageKeys.TRUST_DB'] },
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
