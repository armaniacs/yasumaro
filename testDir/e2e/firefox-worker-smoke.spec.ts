import { test, expect } from '@playwright/test';
import { existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * firefox-worker-smoke.spec.ts
 *
 * Drives the REAL firefox build artifact (dist/firefox-mv3/opfs-worker.js)
 * through INIT (with the stable public wasm URL) → INSERT → QUERY → STATUS
 * on an http origin. This validates the full worker + wasm-file chain without
 * installing the extension — the production equivalent of the failing smoke
 * (opfs-worker inlined wasm as data:, blocked by the extension CSP).
 *
 * Firefox-only: the worker entry (entrypoints/opfs-worker.ts) is excluded
 * from the chromium build (include: ['firefox']).
 */
test('firefox opfs-worker smoke (real dist artifact)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'firefox', 'firefox-only smoke (opfs-worker entry is firefox-only)');
  test.setTimeout(120_000);

  const workerOnDisk = join(__dirname, '../../dist/firefox-mv3/opfs-worker.js');
  test.skip(!existsSync(workerOnDisk), 'firefox dist not built; run npm run build:firefox first');

  await page.goto('http://localhost:8080/worker-smoke.html?worker=/dist/firefox-mv3/opfs-worker.js');
  await expect(page.locator('body[data-status="done"]')).toBeAttached({ timeout: 90_000 });
  const result = JSON.parse((await page.locator('#result').textContent()) as string);
  expect(result.fatal, `worker smoke failed: ${result.fatal}`).toBeUndefined();
  expect(result.initialized, `INIT: ${JSON.stringify(result)}`).toBe(true);
  expect(result.inserted, `INSERT: ${JSON.stringify(result)}`).toBe(true);
  expect(result.queried, `QUERY: ${JSON.stringify(result)}`).toBe(true);
  expect(result.statusOk, `STATUS: ${JSON.stringify(result)}`).toBe(true);
});
