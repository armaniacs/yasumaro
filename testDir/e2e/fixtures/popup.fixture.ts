import { test as base, expect, Page } from '@playwright/test';
import { join } from 'path';
import { EXTENSION_PATH } from './launchExtensionContext.js';
import { createPopupFixture } from './popup-shared.fixture.js';

const POPUP_PATH = join(EXTENSION_PATH, 'popup.html');

type StaticPopupFixtures = {
  popupPage: Page;
};

export const test = base.extend<StaticPopupFixtures>({
  popupPage: async ({ page }, use) => {
    await page.goto(`file://${POPUP_PATH}`);
    await use(page);
  },
});

function popupInteractionInit(): void {
  // Prevent popup from closing
  window.close = () => {};

  // Intercept chrome.tabs.create to prevent actually opening a new tab in tests.
  // The popup now opens the dashboard (options.html) instead of showing an inline
  // settings screen, so we just return a resolved promise/callback.
  chrome.tabs.create = (_createProperties: any, callback?: (tab: chrome.tabs.Tab) => void) => {
    if (callback) {
      callback({ id: 999, index: 0, highlighted: false, active: false, pinned: false, incognito: false } as chrome.tabs.Tab);
    }
    return Promise.resolve({ id: 999, index: 0, highlighted: false, active: false, pinned: false, incognito: false } as chrome.tabs.Tab);
  };
}

export const testInteraction = createPopupFixture({
  seedPolicy: { consent: true, settingsMigrated: true },
  tabStub: 'none',
  initScript: { script: popupInteractionInit },
});
export { expect };
