/**
 * Repository-root resolution for source-scanning tests.
 *
 * Hygiene gates (cap registries, single-interpreter pins, layer checks) read
 * the committed source tree. Under a Stryker sandbox directory those reads
 * would hit instrumented copies and produce false positives or negatives, so
 * paths derived from the running test file must be mapped back to the real
 * repository root first (walk up to the directory holding package.json).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join, sep } from 'node:path';
import { existsSync } from 'node:fs';

const SANDBOX_MARKER = `${sep}.stryker-tmp${sep}`;

/** Map any directory inside the repo (or a Stryker sandbox copy) to the real repo root. */
export function resolveRepoRoot(fromDir: string): string {
  let dir = fromDir;
  const idx = dir.indexOf(SANDBOX_MARKER);
  if (idx !== -1) dir = dir.slice(0, idx);
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`repoRoot: package.json not found above ${fromDir}`);
    dir = parent;
  }
}

/** Repo root derived from the calling test file's URL (use `import.meta.url`). */
export function repoRootFromUrl(fileUrl: string): string {
  return resolveRepoRoot(dirname(fileURLToPath(fileUrl)));
}
