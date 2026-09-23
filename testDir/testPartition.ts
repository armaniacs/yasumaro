/**
 * Splits the unit-test files into two Vitest projects by what they touch.
 *
 * With `isolate: true`, Vitest spawns a fresh worker per test file, so every
 * file pays process start + setup-file import. Files that only exercise code
 * through its public API do not need that fresh worker and run with
 * `isolate: false`. Anything that swaps module or global state (module mocks,
 * spies, global stubs, fake timers, direct chrome/global assignments, a
 * shared wasm instance) stays isolated, because that state would otherwise
 * leak into the next file on the same worker.
 *
 * Files with an `@vitest-environment` docblock stay isolated as well: DOM
 * code keeps module-level state tied to a document (e.g. the original-parent
 * map in aiProviderLayoutManager.ts), which leaked across jsdom files in
 * shuffled runs.
 *
 * Classification is by source text at config load, so a new test that starts
 * mocking moves to the isolated project automatically. The pattern is
 * deliberately over-inclusive: a false positive only costs speed. Run the
 * `shared` project with `--sequence.shuffle` to surface a leak it misses.
 */
import fs from 'node:fs';
import path from 'node:path';

const NEEDS_ISOLATION = new RegExp(
  [
    String.raw`vi\.(mock|doMock|unmock|doUnmock|hoisted|spyOn|stubGlobal|stubEnv|resetModules|useFakeTimers|setSystemTime|importMock)\b`,
    String.raw`@vitest-environment`,
    // Direct writes to shared globals, including `(chrome.x.y as T) = ...`.
    String.raw`\b(global|globalThis|window|self|chrome|process\.env)\b[\w.\[\]'"]*(\s+as\s+[^)=]+\))?\s*=(?!=)`,
    String.raw`Object\.(defineProperty|assign)\(\s*(global|globalThis|window|chrome)\b`,
    String.raw`\bdelete\s+(global|globalThis|window|chrome)\b`,
    // A real sqlite-wasm module keeps named in-memory databases alive across
    // files that share its instance.
    String.raw`sqlite-wasm|wa-sqlite`,
  ].join('|'),
);

export interface TestPartition {
  /** Files safe to run without per-file isolation. */
  shared: string[];
}

export function partitionTestFiles(root: string, include: string[], exclude: string[]): TestPartition {
  // `dir/**` matches only the contents; add `dir` itself so the walk prunes
  // node_modules and friends instead of descending into them.
  const prune = exclude.flatMap((pattern) => (pattern.endsWith('/**') ? [pattern, pattern.slice(0, -3)] : [pattern]));
  const files = fs.globSync(include, { cwd: root, exclude: prune });
  const shared = files.filter((file) => !NEEDS_ISOLATION.test(fs.readFileSync(path.join(root, file), 'utf8')));
  return { shared };
}
