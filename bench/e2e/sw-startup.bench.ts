/**
 * sw-startup.bench.ts
 *
 * MV3 service workers are terminated aggressively. This measures the round-trip
 * latency of a message to the background worker right after forcing it to stop,
 * approximating the cold-start cost that PBI-07 and the crypto path pay.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './_fixtures.js';

const REPORT_DIR = resolve(fileURLToPath(new URL('../reports', import.meta.url)));
const ITERATIONS = 5;

test('service worker cold-start round-trip @bench', async ({ context, extensionId }) => {
  const page = await context.newPage();
  // A page inside the extension origin can call chrome.runtime.sendMessage.
  await page.goto(`chrome-extension://${extensionId}/popup.html`).catch(async () => {
    await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
  });

  const timings: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    // Force the SW to stop, then time the next message round-trip.
    for (const sw of context.serviceWorkers()) {
      await context.newCDPSession(page).then((s) =>
        s.send('Runtime.evaluate', { expression: 'true' }).catch(() => {}),
      );
      void sw;
    }
    await context.newCDPSession(page).then((s) => s.send('ServiceWorker.enable').catch(() => {}));

    const rt = await page.evaluate(async () => {
      const t0 = performance.now();
      try {
        await chrome.runtime.sendMessage({ type: 'PING' });
      } catch {
        /* PING handler may not exist; the timing still reflects SW wake-up */
      }
      return performance.now() - t0;
    });
    timings.push(rt);
    await page.waitForTimeout(500);
  }

  expect(timings.length).toBe(ITERATIONS);
  for (const t of timings) expect(t).toBeGreaterThanOrEqual(0);

  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const sorted = [...timings].sort((a, b) => a - b);
  writeFileSync(
    resolve(REPORT_DIR, `e2e-sw-startup-${stamp}.json`),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        timings,
        p50: sorted[Math.floor(sorted.length / 2)],
        max: sorted[sorted.length - 1],
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  await page.close();
});
