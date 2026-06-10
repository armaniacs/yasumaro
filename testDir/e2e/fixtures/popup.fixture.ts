import { test as base, expect, Page, BrowserContext } from '@playwright/test';
import { chromium, type ChromiumBrowserContext } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const EXTENSION_PATH = join(__dirname, '../../../dist/chromium-mv3');
const POPUP_PATH = join(__dirname, '../../../dist/chromium-mv3/popup.html');

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
    // Use existing page or create new one
    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();

    // Capture console logs for debugging
    page.on('console', msg => {
      console.log(`[Popup Console] ${msg.type()}: ${msg.text()}`);
    });

    // Mock chrome APIs on every page load to prevent popup from closing
    // This must be done with addInitScript to survive page.reload()
    await page.addInitScript(() => {
      // Initialize storage flags BEFORE popup.ts initPopup runs
      chrome.storage.local.set({
        privacyConsent: { accepted: true, timestamp: Date.now() },
        settings_migrated: true
      });

      // Prevent popup from closing
      window.close = () => {};

      // Intercept chrome.tabs.create to show settings screen instead of opening new tab
      const originalCreate = chrome.tabs.create;
      chrome.tabs.create = (createProperties: any, callback?: (tab: chrome.tabs.Tab) => void) => {
        // Show settings screen in popup instead of opening new tab
        const mainScreen = document.getElementById('mainScreen');
        const settingsScreen = document.getElementById('settingsScreen');
        const menuBtn = document.getElementById('menuBtn');
        if (mainScreen) mainScreen.style.display = 'none';
        if (settingsScreen) settingsScreen.style.display = 'block';
        if (menuBtn) menuBtn.setAttribute('aria-expanded', 'true');

        if (callback) {
          callback({ id: 999, index: 0, highlighted: false, active: false, pinned: false, incognito: false } as chrome.tabs.Tab);
        }
        return Promise.resolve({ id: 999, index: 0, highlighted: false, active: false, pinned: false, incognito: false } as chrome.tabs.Tab);
      };

      // Mock chrome.runtime.sendMessage to handle connection test
      const originalSendMessage = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = (message: any, callback?: (response: any) => void) => {
        if (message && message.type === 'TEST_CONNECTION') {
          console.log('[Fixture Mock] TEST_CONNECTION intercepted, returning success');
          // Always return success for connection test in test environment
          if (callback) {
            callback({ success: true, message: 'Test connection successful' });
          }
          return Promise.resolve({ success: true, message: 'Test connection successful' });
        }
        // For other messages, use original implementation
        return originalSendMessage.call(chrome.runtime, message, callback);
      };
    });

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
