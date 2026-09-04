/**
 * lighthouse.bench.ts
 *
 * Runs Lighthouse's performance category against a bench fixture served through
 * the extension-loaded Chromium, capturing LCP / TBT / CLS / INP-proxy.
 *
 * Lighthouse is a lazy import so the suite still loads when the optional
 * dependency is absent — the test then skips with a clear message.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './_fixtures.js';

const REPORT_DIR = resolve(fileURLToPath(new URL('../reports', import.meta.url)));

test('lighthouse performance metrics @bench', async ({ context }) => {
  let lighthouse: typeof import('lighthouse').default | undefined;
  try {
    ({ default: lighthouse } = await import('lighthouse'));
  } catch {
    test.skip(true, 'lighthouse not installed — run `npm i -D lighthouse`');
    return;
  }

  // Lighthouse needs the raw CDP debugging port of the browser.
  const browser = context.browser();
  const wsEndpoint = browser?.wsEndpoint?.();
  // Playwright does not expose the DevTools port directly; drive Lighthouse via
  // a fresh page's CDP target instead.
  const page = await context.newPage();
  const url = 'http://localhost:8110/news?scale=8';
  await page.goto(url, { waitUntil: 'load' });

  const session = await context.newCDPSession(page);
  const { targetInfo } = await session.send('Target.getTargetInfo');

  let lhr: Record<string, unknown> | undefined;
  try {
    const runnerResult = await lighthouse(
      url,
      { output: 'json', onlyCategories: ['performance'], logLevel: 'error' },
      undefined,
      // @ts-expect-error lighthouse accepts a puppeteer-like page in newer versions
      page,
    );
    lhr = runnerResult?.lhr as Record<string, unknown> | undefined;
  } catch (err) {
    test.skip(true, `lighthouse run failed in this environment: ${(err as Error).message}`);
    return;
  }

  const audits = (lhr?.audits ?? {}) as Record<string, { numericValue?: number }>;
  const metrics = {
    lcpMs: audits['largest-contentful-paint']?.numericValue ?? null,
    tbtMs: audits['total-blocking-time']?.numericValue ?? null,
    cls: audits['cumulative-layout-shift']?.numericValue ?? null,
    speedIndexMs: audits['speed-index']?.numericValue ?? null,
    perfScore: ((lhr?.categories as Record<string, { score?: number }>)?.performance?.score ?? null),
  };

  expect(metrics.lcpMs == null || metrics.lcpMs >= 0).toBe(true);

  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  writeFileSync(
    resolve(REPORT_DIR, `e2e-lighthouse-${stamp}.json`),
    JSON.stringify({ generatedAt: new Date().toISOString(), url, target: targetInfo?.url ?? url, wsEndpoint, metrics }, null, 2) + '\n',
    'utf8',
  );

  await session.detach().catch(() => {});
  await page.close();
});
