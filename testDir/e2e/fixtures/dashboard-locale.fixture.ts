/**
 * Fixture for i18n-layout.spec.ts (PBI 2026-09-13-50).
 *
 * chrome.i18n.getMessage() resolves against the browser's UI locale, which
 * for a Chromium extension test can only be set at context launch time
 * (Playwright's `locale` context option), not toggled at runtime via JS.
 * This fixture is parameterized per-test via test.use({ locale }).
 */
import { test as base, expect, Page } from '@playwright/test';
import { chromium, type ChromiumBrowserContext } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const EXTENSION_PATH = join(__dirname, '../../../dist/chromium-mv3');

type Fixtures = {
  context: ChromiumBrowserContext;
  extensionId: string;
  dashboardPage: Page;
};

export const test = base.extend<Fixtures>({
  context: async ({ locale }, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      locale,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        `--lang=${locale}`,
      ],
    });
    await use(context as ChromiumBrowserContext);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker');
    }
    await use(serviceWorker.url().split('/')[2] ?? '');
  },

  dashboardPage: async ({ context, extensionId }, use) => {
    const pages = context.pages();
    const page: Page = pages[0] ?? (await context.newPage());

    await page.addInitScript(() => {
      chrome.storage.local.set({
        privacyConsent: { accepted: true, timestamp: Date.now() },
        settings_migrated: true,
        breaking_changes_v5_shown: true,
        ai_provider: 'gemini',
        ai_provider_priority_list: [],
        ai_provider_layout: 'a',
      });
    });

    await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'networkidle' });
    await expect(page.locator('#geminiSettings')).toBeVisible();

    await use(page);
  },
});

export { expect };
