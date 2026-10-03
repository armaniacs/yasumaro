/**
 * Fixture for i18n-layout.spec.ts (PBI 2026-09-13-50).
 *
 * chrome.i18n.getMessage() resolves against the browser's UI locale, which
 * for a Chromium extension test can only be set at context launch time
 * (Playwright's `locale` context option + --lang), not toggled at runtime
 * via JS. This fixture is parameterized per-test via test.use({ locale }).
 */
import { test as base, expect, Page } from '@playwright/test';
import type { ChromiumBrowserContext } from 'playwright';
import {
  launchExtensionContext,
  resolveExtensionId,
  HEADLESS_FIXME_MESSAGE,
} from './launchExtensionContext.js';

type Fixtures = {
  context: ChromiumBrowserContext;
  extensionId: string;
  dashboardPage: Page;
};

export const test = base.extend<Fixtures>({
  context: async ({ locale }, use) => {
    const context = await launchExtensionContext({
      locale,
      seedPolicy: {
        consent: true,
        settingsMigrated: true,
        breakingChangesShown: true,
        // This spec is about layout/locale rendering, not the provider
        // synthesis path: an explicitly empty (user-configured) list keeps
        // every provider panel hidden, which is what the pre-unification
        // seed did — see ProviderPriorityListSeed.
        provider: { name: 'gemini', layout: 'a', priorityList: 'empty' },
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

    await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'networkidle' });
    await expect(page.locator('#geminiSettings')).toBeVisible();

    await use(page);
  },
});

export { expect };
export type { Page };
