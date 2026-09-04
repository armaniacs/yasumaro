/**
 * _fixtures.ts — Playwright fixtures for the e2e benchmark suite.
 *
 * Mirrors testDir/e2e/fixtures/extension.fixture.ts: launches a persistent
 * headed Chromium with the built extension, and skips gracefully when the
 * environment cannot run Manifest V3 service workers (headless CI, SSH).
 *
 * Adds a `cdp` fixture (CDP session on a fresh page) and `throttleCpu` helper
 * so benches run under a fixed 4x CPU slowdown for machine-independent numbers.
 */
import { test as base, chromium, type BrowserContext, type CDPSession, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.join(__dirname, '../../dist/chromium-mv3');

export const CPU_THROTTLE_RATE = 4;
export const BENCH_FIXTURE_PORT = 8110;

type BenchFixtures = {
  context: BrowserContext;
  extensionId: string;
  benchPage: Page;
  cdp: CDPSession;
};

async function tryLaunch(): Promise<BrowserContext | null> {
  try {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    const started = await Promise.race([
      new Promise<boolean>((res) => {
        const check = () => (context.serviceWorkers().length ? res(true) : setTimeout(check, 200));
        check();
      }),
      new Promise<boolean>((res) => setTimeout(() => res(false), 5000)),
    ]);
    if (started) return context;
    await context.close();
    return null;
  } catch {
    return null;
  }
}

export const test = base.extend<BenchFixtures>({
  context: async ({}, use) => {
    const context = await tryLaunch();
    if (!context) {
      test.skip(true, 'e2e bench needs headed Chrome with a built extension (npm run build)');
      return;
    }
    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    if (!context) return;
    const sw = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker', { timeout: 10_000 }));
    await use(sw.url().split('/')[2]);
  },

  benchPage: async ({ context }, use) => {
    const page = await context.newPage();
    await use(page);
    await page.close();
  },

  cdp: async ({ context, benchPage }, use) => {
    const session = await context.newCDPSession(benchPage);
    await use(session);
    await session.detach().catch(() => {});
  },
});

/** Apply a fixed CPU slowdown so timings are comparable across machines. */
export async function throttleCpu(cdp: CDPSession, rate = CPU_THROTTLE_RATE): Promise<void> {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
}

export { expect } from '@playwright/test';
