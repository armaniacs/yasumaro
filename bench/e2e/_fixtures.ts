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
import { test as base, type BrowserContext, type CDPSession, type Page } from '@playwright/test';
import {
  launchExtensionContext,
  resolveExtensionId,
} from '../../testDir/e2e/fixtures/launchExtensionContext.js';

export const CPU_THROTTLE_RATE = 4;
export const BENCH_FIXTURE_PORT = 8110;

type BenchFixtures = {
  context: BrowserContext;
  extensionId: string;
  benchPage: Page;
  cdp: CDPSession;
};

async function tryLaunch(): Promise<BrowserContext | null> {
  return launchExtensionContext({ seedPolicy: { consent: true } });
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
    await use(await resolveExtensionId(context));
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
