import { test as base, expect, Page } from '@playwright/test';
import type { ChromiumBrowserContext } from 'playwright';
import {
  launchExtensionContext,
  resolveExtensionId,
  HEADLESS_FIXME_MESSAGE,
} from './launchExtensionContext.js';

type DashboardFixtures = {
  context: ChromiumBrowserContext;
  extensionId: string;
  dashboardPage: Page;
};

const testExt = base.extend<DashboardFixtures>({
  context: async ({}, use) => {
    // 'synthesize': no flat ai_provider_priority_list here — the SW's
    // deferred migration synthesizes the priority list from ai_provider
    // (see ProviderPriorityListSeed in launchExtensionContext.ts).
    const context = await launchExtensionContext({
      seedPolicy: {
        consent: true,
        breakingChangesShown: true,
        provider: { name: 'gemini', layout: 'a', priorityList: 'synthesize' },
      },
    });
    if (!context) {
      testExt.fixme(true, HEADLESS_FIXME_MESSAGE);
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

    page.on('console', msg => {
      console.log(`[Dashboard Console] ${msg.type()}: ${msg.text()}`);
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
