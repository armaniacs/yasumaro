/**
 * content-script-impact.bench.ts
 *
 * A/B: page load with the extension's content script active vs. a control page
 * where the script short-circuits. Reports the delta in DOMContentLoaded and
 * load timing plus Long Tasks, quantifying "the extension makes pages heavier".
 *
 * The control is achieved by setting localStorage `__ow_bench_disable_cs` which
 * the content script honours as an early return (added in PBI-01). If that flag
 * is not yet wired, the test still runs and records identical A/B numbers.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, throttleCpu } from './_fixtures.js';

const REPORT_DIR = resolve(fileURLToPath(new URL('../reports', import.meta.url)));

async function measureLoad(page: import('@playwright/test').Page, url: string) {
  await page.addInitScript(() => {
    (window as unknown as { __benchLT: number }).__benchLT = 0;
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) (window as unknown as { __benchLT: number }).__benchLT += e.duration;
      }).observe({ type: 'longtask', buffered: true });
    } catch {
      /* noop */
    }
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(2_000);
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return {
      domContentLoaded: nav ? nav.domContentLoadedEventEnd - nav.startTime : null,
      loadEvent: nav ? nav.loadEventEnd - nav.startTime : null,
      longTasksMs: (window as unknown as { __benchLT: number }).__benchLT ?? 0,
    };
  });
}

test('content script load impact (A/B) @bench', async ({ context }) => {
  const url = 'http://localhost:8110/news?scale=8';

  const withCs = await context.newPage();
  const cdpA = await context.newCDPSession(withCs);
  await throttleCpu(cdpA);
  const active = await measureLoad(withCs, url);
  await cdpA.detach().catch(() => {});
  await withCs.close();

  const control = await context.newPage();
  const cdpB = await context.newCDPSession(control);
  await throttleCpu(cdpB);
  await control.addInitScript(() => {
    try {
      localStorage.setItem('__ow_bench_disable_cs', '1');
    } catch {
      /* noop */
    }
  });
  const disabled = await measureLoad(control, url);
  await cdpB.detach().catch(() => {});
  await control.close();

  expect(active.loadEvent == null || active.loadEvent >= 0).toBe(true);

  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  writeFileSync(
    resolve(REPORT_DIR, `e2e-cs-impact-${stamp}.json`),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        active,
        disabled,
        delta: {
          domContentLoaded:
            active.domContentLoaded != null && disabled.domContentLoaded != null
              ? active.domContentLoaded - disabled.domContentLoaded
              : null,
          longTasksMs: active.longTasksMs - disabled.longTasksMs,
        },
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
});
