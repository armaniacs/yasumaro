/**
 * autosave-latency.bench.ts
 *
 * End-to-end signal for PBI 02-08: how long the content script spends between
 * `ow-extract-start` and `ow-send-ready` (synchronous extract + cleanse), plus
 * the Long Tasks total (TBT proxy) and JS heap size at that moment.
 *
 * Emits bench/reports/e2e-autosave-<date>.json for baseline tracking.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, throttleCpu } from './_fixtures.js';

const REPORT_DIR = resolve(fileURLToPath(new URL('../reports', import.meta.url)));
const SCALES = [1, 4, 16];

test('autosave latency across page sizes @bench', async ({ benchPage, cdp }) => {
  await throttleCpu(cdp);
  await cdp.send('Performance.enable').catch(() => {});

  const samples: Record<string, unknown>[] = [];

  for (const scale of SCALES) {
    // Instrument Long Tasks before navigation.
    await benchPage.addInitScript(() => {
      (window as unknown as { __benchLongTasks: number }).__benchLongTasks = 0;
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            (window as unknown as { __benchLongTasks: number }).__benchLongTasks += e.duration;
          }
        }).observe({ type: 'longtask', buffered: true });
      } catch {
        /* longtask unsupported */
      }
    });

    await benchPage.goto(`http://localhost:8110/news?scale=${scale}`, { waitUntil: 'load' });

    // The content script auto-reports after the visit threshold; nudge it by
    // scrolling and waiting past the min duration.
    await benchPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await benchPage.waitForTimeout(6_000);

    const result = await benchPage.evaluate(() => {
      const marks = performance.getEntriesByType('mark');
      const start = marks.find((m) => m.name === 'ow-extract-start')?.startTime;
      const end = marks.find((m) => m.name === 'ow-send-ready')?.startTime;
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      return {
        extractMs: start != null && end != null ? end - start : null,
        longTasksMs: (window as unknown as { __benchLongTasks: number }).__benchLongTasks ?? 0,
        heapBytes: mem?.usedJSHeapSize ?? null,
      };
    });

    samples.push({ scale, ...result });
  }

  // At least one scale must have produced a mark pair; otherwise the content
  // script did not run (or the marks regressed).
  const withMarks = samples.filter((s) => typeof s.extractMs === 'number');
  expect(withMarks.length, `no ow-extract-start/ow-send-ready marks captured: ${JSON.stringify(samples)}`).toBeGreaterThan(0);
  for (const s of withMarks) {
    expect(s.extractMs as number).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(s.extractMs as number)).toBe(true);
  }

  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  writeFileSync(
    resolve(REPORT_DIR, `e2e-autosave-${stamp}.json`),
    JSON.stringify({ generatedAt: new Date().toISOString(), samples }, null, 2) + '\n',
    'utf8',
  );
});
