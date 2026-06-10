import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Obsidian Weave Chrome Extension
 * 
 * This configuration is set up for E2E testing of the extension's popup UI
 * and content script functionality.
 */
export default defineConfig({
  testDir: './e2e',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [['html'], ['list']],
  /* Global test timeout */
  timeout: 30_000,
  /* Assertion timeout */
  expect: {
    timeout: 5_000,
  },
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page/goto('/')`. */
    // baseURL: 'http://127.0.0.1:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    /* Capture screenshot on failure */
    screenshot: 'only-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      grep: /^(?!.*@(?:interaction|extension))/,
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      grep: /^(?!.*@(?:interaction|extension))/,
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'extension',
      testDir: './e2e',
      grepInverse: /@extension/,  // Skip tests matching @extension
      timeout: 60_000,
      expect: { timeout: 15_000 },
      fullyParallel: false,
      retries: 0,
      workers: 1,
      use: { 
        ...devices['Desktop Chrome'],
        channel: 'chromium',
      },
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'node e2e/test-pages/server.mjs',
    port: 8080,
    reuseExistingServer: !process.env.CI,
  },
});
