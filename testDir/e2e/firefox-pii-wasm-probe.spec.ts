import { test, expect } from '@playwright/test';
import { buildSync } from 'esbuild';
import { copyFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * firefox-pii-wasm-probe.spec.ts
 *
 * Firefox-side companion to pii-wasm-initialization.spec.ts. Chromium WASM
 * init inside the real extension is proven there, but Playwright cannot
 * install the extension into Firefox, so the full extension-context path
 * (chrome.runtime.getURL inside a Firefox extension service worker) remains
 * manual QA (see tests.yml's firefox-storage job comment). This probe closes
 * the remaining automatable gap: it drives the exact committed
 * pii_sanitizer_bg.wasm — the same bytes the extension ships — through
 * init-from-same-origin-URL + sanitizePii inside a Firefox module worker,
 * the same engine (SpiderMonkey) and context class as the Firefox extension
 * service worker. The extension's own 2e57ace3 fix makes the binary a
 * fetchable file rather than an inlined data: URI; this probe would catch a
 * regression to an unloadable binary on the Firefox engine specifically.
 *
 * Expected outputs are verbatim from wasm/pii-sanitizer/src/lib.rs's unit
 * tests; full 21-pattern parity stays the job of the vitest parity suites
 * (src/wasm/pii-sanitizer/__tests__/).
 *
 * The `firefox` project is the subject; `chromium` runs the same probe as a
 * known-good control (pii-wasm-initialization.spec.ts proves the extension
 * path there).
 *
 * Run with: npx playwright test --config testDir/playwright.config.ts --project=firefox e2e/firefox-pii-wasm-probe.spec.ts
 */
test('PII sanitizer WASM core initializes and masks in a browser worker', async ({ page }, testInfo) => {
  test.setTimeout(120_000);

  // Bundle per project so concurrently running projects never share files.
  const outDir = join(__dirname, 'test-pages/probe/dist', testInfo.project.name);
  mkdirSync(outDir, { recursive: true });
  buildSync({
    entryPoints: [join(__dirname, 'test-pages/probe/pii-wasm-worker.ts')],
    outfile: join(outDir, 'pii-wasm-worker.js'),
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    logLevel: 'silent',
  });
  // public/wasm is what the extension actually ships (wxt's publicAssets
  // hook copies it to dist/<browser>-mv3/wasm/), so the probe validates the
  // shipped bytes, not the src/wasm build output — the two are identical
  // only as long as build:wasm was run and both copies were committed,
  // which CI's wasm-test job gates.
  copyFileSync(
    join(__dirname, '../../public/wasm/pii_sanitizer_bg.wasm'),
    join(outDir, 'pii-sanitizer.wasm'),
  );

  await page.goto(
    `http://localhost:8080/probe/probe.html?worker=./dist/${testInfo.project.name}/pii-wasm-worker.js`,
  );
  await expect(page.locator('body[data-status="done"]')).toBeAttached({ timeout: 90_000 });
  const result = JSON.parse((await page.locator('#result').textContent()) as string);
  expect(result.fatal, `worker crashed: ${result.fatal}`).toBeUndefined();
  expect(result.init, 'WASM module failed to initialize from a same-origin URL').toBe('ok');
  const failures = result.cases.filter((c: { ok: boolean }) => !c.ok);
  expect(failures, `case failures: ${JSON.stringify(failures, null, 1)}`).toHaveLength(0);
  expect(result.allOk).toBe(true);
});
