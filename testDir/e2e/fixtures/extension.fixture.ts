import { test as base, BrowserContext } from '@playwright/test';
import {
  launchExtensionContext,
  resolveExtensionId,
  HEADLESS_FIXME_MESSAGE,
} from './launchExtensionContext.js';

type ExtensionFixtures = {
  context: BrowserContext;
  extensionId: string;
};

export const test = base.extend<ExtensionFixtures>({
  context: async ({}, use) => {
    const context = await launchExtensionContext();
    if (!context) {
      test.fixme(true, HEADLESS_FIXME_MESSAGE);
      return;
    }
    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    if (!context) return;
    await use(await resolveExtensionId(context));
  },
});

export { expect } from '@playwright/test';
