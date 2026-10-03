/**
 * Fixture for dashboard-issue-report.spec.ts (PBI 2026-09-13-51).
 *
 * Extends the unified launch context with:
 * - a Gemini API key seeded into storage (so the sanitization contract has
 *   something real to exclude)
 * - a chrome.tabs.create stub that records the URL instead of opening a tab
 */
import { test as base, expect, Page } from '@playwright/test';
import type { ChromiumBrowserContext } from 'playwright';
import {
  launchExtensionContext,
  resolveExtensionId,
  HEADLESS_FIXME_MESSAGE,
} from './launchExtensionContext.js';

export const SEEDED_API_KEY = 'test-secret-key-should-never-leak';

type Fixtures = {
  context: ChromiumBrowserContext;
  extensionId: string;
  dashboardPage: Page;
};

export const test = base.extend<Fixtures>({
  context: async ({}, use) => {
    // priorityList 'empty' + apiKey: the sanitization contract needs the
    // provider panel for the keyed provider visible under a user-configured
    // (explicitly empty) priority list — see ProviderPriorityListSeed.
    const context = await launchExtensionContext({
      seedPolicy: {
        consent: true,
        settingsMigrated: true,
        breakingChangesShown: true,
        provider: {
          name: 'gemini',
          layout: 'a',
          priorityList: 'empty',
          apiKey: SEEDED_API_KEY,
        },
      },
    });
    if (!context) {
      test.fixme(true, HEADLESS_FIXME_MESSAGE);
      return;
    }
    await use(context as ChromiumBrowserContext);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    if (!context) return;
    await use(await resolveExtensionId(context));
  },

  dashboardPage: async ({ context, extensionId }, use) => {
    const pages = context.pages();
    const page: Page = pages[0] ?? (await context.newPage());

    await page.addInitScript(() => {
      (window as any).__createdTabUrls = [];

      chrome.tabs.create = ((createProperties: chrome.tabs.CreateProperties, callback?: (tab: chrome.tabs.Tab) => void) => {
        (window as any).__createdTabUrls.push(createProperties?.url);
        const fakeTab = { id: 999, index: 0, highlighted: false, active: false, pinned: false, incognito: false } as chrome.tabs.Tab;
        if (callback) callback(fakeTab);
        return Promise.resolve(fakeTab);
      }) as typeof chrome.tabs.create;
    });

    await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'networkidle' });
    await expect(page.locator('#geminiSettings')).toBeVisible();

    await use(page);
  },
});

export { expect };
