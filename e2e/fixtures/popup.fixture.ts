import { test as base, expect, Page, BrowserContext } from '@playwright/test';
import { chromium, type ChromiumBrowserContext } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const EXTENSION_PATH = join(__dirname, '../../dist/chromium-mv3');
const POPUP_PATH = join(__dirname, '../../dist/chromium-mv3/popup.html');

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
    // Set privacy consent in storage using CDP to avoid modal blocking UI
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Runtime.evaluate', {
      expression: `chrome.storage.local.set({ privacyConsent: { accepted: true, timestamp: Date.now() } })`
    });
    await cdp.detach();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    // Accept privacy consent if modal is visible
    const consentModal = page.locator('#privacyConsentModal');
    if (await consentModal.isVisible().catch(() => false)) {
      await page.locator('#consentCheckbox').check();
      await page.locator('#acceptConsentBtn').click();
    }
    await use(page);
  },
});

export const testInteraction = testExt;
export { expect };
