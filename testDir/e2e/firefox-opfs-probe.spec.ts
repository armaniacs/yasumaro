import { test, expect } from '@playwright/test';
import { buildSync } from 'esbuild';
import { copyFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * firefox-opfs-probe.spec.ts
 *
 * Answers the single question blocking the Firefox port: does the wa-sqlite
 * SyncAccessHandle (OPFS) VFS — the same library and init options the
 * extension's offscreen document uses (src/offscreen/sqliteEngine.ts) — work
 * against this browser's OPFS implementation? Runs as a plain module worker on
 * an http origin, so no extension install and no chrome.offscreen are involved.
 *
 * The `firefox` project is the subject; `chromium` runs the same probe as a
 * known-good control (the extension ships this exact path in production).
 * The IDB VFS probe covers the documented fallback strategy
 * (src/offscreen/opfsCapabilities.ts: opfs-sync-worker -> idb -> fallback).
 */
test('wa-sqlite OPFS (SAH) and IDB VFS probe', async ({ page }, testInfo) => {
  test.setTimeout(120_000);

  // Bundle per project so concurrently running projects never share files.
  const outDir = join(__dirname, 'test-pages/probe/dist', testInfo.project.name);
  mkdirSync(outDir, { recursive: true });
  buildSync({
    entryPoints: [join(__dirname, 'test-pages/probe/probe-worker.ts')],
    outfile: join(outDir, 'worker.js'),
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    logLevel: 'silent',
  });
  // The @subframe7536/sqlite-wasm glue must pair with a wasm from the SAME
  // build family — verified empirically in chromium: wa-sqlite-async.wasm
  // (devDependency build) fails with "null function", while the
  // @subframe7536 ASYNCIFY wasm passes the full pipeline. The production
  // offscreen IDB path ships exactly this binary.
  copyFileSync(
    join(__dirname, '../../node_modules/@subframe7536/sqlite-wasm/dist/wa-sqlite-async.wasm'),
    join(outDir, 'wa-sqlite.wasm'),
  );

  await page.goto(`http://localhost:8080/probe/probe.html?worker=./dist/${testInfo.project.name}/worker.js`);
  await expect(page.locator('body[data-status="done"]')).toBeAttached({ timeout: 90_000 });
  const result = JSON.parse((await page.locator('#result').textContent()) as string);
  expect(result.fatal, `worker crashed: ${result.fatal}`).toBeUndefined();

  // Capability preconditions (same checks as src/offscreen/opfsCapabilities.ts).
  expect(result.caps.opfsDirectory, `caps: ${JSON.stringify(result.caps)}`).toBe(true);
  expect(result.caps.syncAccessHandle, `caps: ${JSON.stringify(result.caps)}`).toBe(true);

  // Raw OPFS SyncAccessHandle I/O in this worker (no wa-sqlite involved).
  expect(result.rawSah.ok, `rawSah: ${JSON.stringify(result.rawSah)}`).toBe(true);

  // The actual question: wa-sqlite OPFS VFS end-to-end (open/CRUD/FTS5/close/reopen).
  const opfsFailures = result.opfs.steps.filter((s: { ok: boolean }) => !s.ok);
  expect(
    opfsFailures,
    `opfs steps: ${JSON.stringify(result.opfs, null, 1)}`,
  ).toHaveLength(0);
  expect(result.opfs.fts5Matched, 'fts5 match query returned no row').toBe(true);
  expect(result.opfs.persisted, 'data did not survive reopen').toBe(true);

  // Fallback path: the IDB VFS must also be usable on this browser.
  const idbFailures = result.idb.steps.filter((s: { ok: boolean }) => !s.ok);
  expect(idbFailures, `idb steps: ${JSON.stringify(result.idb, null, 1)}`).toHaveLength(0);
  expect(result.idb.persisted, 'idb data did not survive reopen').toBe(true);
});
