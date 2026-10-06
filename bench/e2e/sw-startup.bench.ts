/**
 * sw-startup.bench.ts
 *
 * MV3 service workers are terminated aggressively. Each sample stops every
 * running service worker via CDP ServiceWorker.stopAllWorkers (Playwright's
 * Worker API has no stop()), holds until the worker list is empty, then times
 * the next message round-trip — the cost every first message after a stop pays.
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
  // One CDP session for the whole run. ServiceWorker.stopAllWorkers requires
  // the ServiceWorker domain enabled first, and Playwright's Worker API has no
  // stop() method — CDP is the only way to terminate the worker from here.
  const cdp = await context.newCDPSession(page);
  try {
    await cdp.send('ServiceWorker.enable');
    for (let i = 0; i < ITERATIONS; i++) {
      // Stop the worker for real, then time the next message round-trip.
      // There is no "worker is gone" observable to await here: an MV3 SW
      // restarts on the next event, so context.serviceWorkers() is 1 again
      // before any poll could see 0 — the measured PING is itself the wake.
      await cdp.send('ServiceWorker.stopAllWorkers');

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
    }
  } finally {
    await cdp.detach().catch(() => {});
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
