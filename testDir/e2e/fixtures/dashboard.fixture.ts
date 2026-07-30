import { test as base, expect, Page } from '@playwright/test';
import { chromium, type ChromiumBrowserContext } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const EXTENSION_PATH = join(__dirname, '../../../dist/chromium-mv3');

type DashboardFixtures = {
  context: ChromiumBrowserContext;
  extensionId: string;
  dashboardPage: Page;
};

const testExt = base.extend<DashboardFixtures>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
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
    const extensionId = serviceWorker.url().split('/')[2];
    await use(extensionId);
  },

  dashboardPage: async ({ context, extensionId }, use) => {
    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();

    page.on('console', msg => {
      console.log(`[Dashboard Console] ${msg.type()}: ${msg.text()}`);
    });

    await page.addInitScript(() => {
      chrome.storage.local.set({
        privacyConsent: { accepted: true, timestamp: Date.now() },
        settings_migrated: true,
        breaking_changes_v5_shown: true,
        // Explicit default so tests are independent of state left over by
        // previous tests reusing the same persistent browser context.
        ai_provider: 'gemini',
        ai_provider_priority_list: [],
      });
    });

    await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'networkidle' });

    // Wait for the General panel's async mount() (getSettings() + loadGeneralSettings())
    // to finish wiring up the AI provider select listeners before tests interact with it.
    // refreshMultiVisibility() runs once during mount() and sets the default provider's
    // settings panel (Gemini) to display:block — a reliable signal that mount() completed.
    await expect(page.locator('#geminiSettings')).toBeVisible();

    await use(page);
  },
});

export const testInteraction = testExt;
export { expect };
