import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the e2e benchmark suite (bench/e2e/*.bench.ts).
 *
 * Separate from testDir/playwright.config.ts: single worker, no retries
 * (benchmarks must not be averaged across retries), headed Chromium with the
 * `channel: 'chromium'` needed for MV3 service workers, and its own fixture
 * server on port 8110.
 *
 * Run: npm run bench:e2e  (requires `npm run build` first)
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.bench\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  globalTeardown: './e2e/teardown.mjs',
  use: {
    ...devices['Desktop Chrome'],
    channel: 'chromium',
    trace: 'off',
    video: 'off',
  },
  webServer: {
    command: 'node e2e/server.mjs',
    port: 8110,
    reuseExistingServer: !process.env.CI,
  },
});
