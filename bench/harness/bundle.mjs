/**
 * bundle.mjs — turn a TypeScript source entry into a plain-Node ESM module.
 *
 * `src/` is authored as TS with `.js`-suffixed ESM imports, so `node` cannot
 * import it directly. We esbuild the requested entry into a single ESM file in
 * the OS temp dir, import it, then delete the temp file (the module is already
 * evaluated by then).
 *
 * Extracted from scripts/benchmark-cleansing.mjs so every micro bench shares
 * one bundling path.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { unlinkSync } from 'node:fs';

const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/**
 * @param {string} entry  path relative to the project root, e.g. 'src/utils/contentDeduplicator.ts'
 * @param {{ keepTemp?: boolean }} [opts]
 * @returns {Promise<Record<string, unknown>>} the imported module namespace
 */
export async function importFromSource(entry, opts = {}) {
  const esbuild = await import('esbuild');
  const outPath = resolve(
    tmpdir(),
    `yasumaro-bench-${entry.replace(/[^a-z0-9]+/gi, '-')}-${Date.now()}.mjs`,
  );

  await esbuild.build({
    entryPoints: [resolve(projectRoot, entry)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    outfile: outPath,
    logLevel: 'silent',
    // The extension's `.js` import specifiers resolve to `.ts` on disk.
    resolveExtensions: ['.ts', '.mjs', '.js', '.json'],
  });

  try {
    return await import(outPath);
  } finally {
    if (!opts.keepTemp) {
      try {
        unlinkSync(outPath);
      } catch {
        /* temp file cleanup is best-effort */
      }
    }
  }
}

export { projectRoot };
