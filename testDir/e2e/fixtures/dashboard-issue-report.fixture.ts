/**
 * Fixture for dashboard-issue-report.spec.ts (PBI 2026-09-13-51).
 *
 * Extends dashboard.fixture's persistent-context pattern with:
 * - a Gemini API key seeded into storage (so the sanitization contract has
 *   something real to exclude)
 * - a chrome.tabs.create stub that records the URL instead of opening a tab
 */
import { test as base, expect, Page } from '@playwright/test';
import { chromium, type ChromiumBrowserContext } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const EXTENSION_PATH = join(__dirname, '../../../dist/chromium-mv3');

export const SEEDED_API_KEY = 'test-secret-key-should-never-leak';

type Fixtures = {
  context: ChromiumBrowserContext;
  extensionId: string;
  dashboardPage: Page;
};

export const test = base.extend<Fixtures>({
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
    await use(serviceWorker.url().split('/')[2] ?? '');
  },

  dashboardPage: async ({ context, extensionId }, use) => {
    const pages = context.pages();
    const page: Page = pages[0] ?? (await context.newPage());

    await page.addInitScript((apiKey: string) => {
      (window as any).__createdTabUrls = [];

      // Seed through the supported modern path (the `settings` blob), not
      // only through legacy scattered keys: a partial blob created by key
      // re-encryption would otherwise shadow the flat seeds depending on
      // read timing, making the provider under test nondeterministic.
      const seedSettings = {
        ai_provider: 'gemini',
        ai_provider_priority_list: [],
        ai_provider_layout: 'a',
        gemini_api_key: apiKey,
      };
      chrome.storage.local.set({
        privacyConsent: { accepted: true, timestamp: Date.now() },
        settings_migrated: true,
        breaking_changes_v5_shown: true,
        ...seedSettings,
        settings: seedSettings,
      });

      chrome.tabs.create = ((createProperties: chrome.tabs.CreateProperties, callback?: (tab: chrome.tabs.Tab) => void) => {
        (window as any).__createdTabUrls.push(createProperties?.url);
        const fakeTab = { id: 999, index: 0, highlighted: false, active: false, pinned: false, incognito: false } as chrome.tabs.Tab;
        if (callback) callback(fakeTab);
        return Promise.resolve(fakeTab);
      }) as typeof chrome.tabs.create;
    }, SEEDED_API_KEY);

    await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'networkidle' });
    await expect(page.locator('#geminiSettings')).toBeVisible();

    await use(page);
  },
});

export { expect };
