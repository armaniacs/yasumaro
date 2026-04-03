import { test as base, expect, Page, BrowserContext } from '@playwright/test';
import { chromium, type ChromiumBrowserContext } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const EXTENSION_PATH = join(__dirname, '../../dist');
const POPUP_PATH = join(__dirname, '../../dist/popup/popup.html');

type PopupFixtures = {
  context: ChromiumBrowserContext;
  extensionId: string;
  popupPage: Page;
};

type StaticPopupFixtures = {
  popupPage: Page;
};

export const test = base.extend<StaticPopupFixtures>({
  popupPage: async ({ page }, use) => {
    await page.goto(`file://${POPUP_PATH}`);
    await use(page);
  },
});

export const testExt = base.extend<PopupFixtures>({
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

  popupPage: async ({ context, extensionId }, use) => {
    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await use(page);
  },
});

export const testInteraction = testExt;
export { expect };
