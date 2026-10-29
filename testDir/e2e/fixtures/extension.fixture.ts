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

interface ExtensionFixtureOptions {
  /**
   * Fixed browser UI locale (--lang + Playwright locale option). Omitted by
   * default, so specs without a locale pin launch exactly as before; a spec
   * that asserts chrome.i18n wording pins it via test.use({ locale }).
   */
  locale?: string | undefined;
}

export const test = base.extend<ExtensionFixtureOptions & ExtensionFixtures>({
  context: async ({ locale }, use) => {
    const context = await launchExtensionContext({ locale });
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
