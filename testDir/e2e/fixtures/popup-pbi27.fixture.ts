import { test as base, expect, Page } from '@playwright/test';
import type { ChromiumBrowserContext } from 'playwright';
import { dismissConsentModal } from './consentModal.js';
import {
  launchExtensionContext,
  resolveExtensionId,
  HEADLESS_FIXME_MESSAGE,
} from './launchExtensionContext.js';

type Pbi27Fixtures = {
  context: ChromiumBrowserContext;
  extensionId: string;
  popupPage: Page;
};

/**
 * PBI-27 用のポップアップフィクスチャ。
 * ポップアップを chrome-extension:// URL で開き、chrome.tabs.create と
 * window.close の呼び出しを window グローバルに記録する。
 */
export const test = base.extend<Pbi27Fixtures>({
  context: async ({}, use) => {
    const context = await launchExtensionContext({
      seedPolicy: {
        consent: true,
        settingsMigrated: true,
        onboardingCompleted: true,
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

  popupPage: async ({ context, extensionId }, use) => {
    const pages = context.pages();
    const page: Page = pages[0] ?? (await context.newPage());

    await page.addInitScript(() => {
      (window as any).__createdTabUrls = [];
      (window as any).__closeCalled = false;

      // Not this spec's concern — the onboarding wizard now launches
      // reactively right after the user accepts consent in the same
      // session (PBI 0913a popup.ts fix), which would otherwise cover
      // #menuBtn here. Mark onboarding done so this fixture's UI-driven
      // consent acceptance below doesn't trigger it (seeded at launch via
      // the seed policy).
      window.close = () => {
        (window as any).__closeCalled = true;
      };

      chrome.tabs.create = (createProperties: any, callback?: (tab: chrome.tabs.Tab) => void) => {
        (window as any).__createdTabUrls.push(createProperties?.url);
        if (callback) {
          callback({ id: 999, index: 0, highlighted: false, active: false, pinned: false, incognito: false } as chrome.tabs.Tab);
        }
        return Promise.resolve({ id: 999, index: 0, highlighted: false, active: false, pinned: false, incognito: false } as chrome.tabs.Tab);
      };

      chrome.tabs.query = (_queryInfo: any, callback?: (result: chrome.tabs.Tab[]) => void) => {
        const tab = {
          id: 1,
          url: 'https://example.com/page',
          title: 'Example Page',
          active: true,
          index: 0,
          highlighted: false,
          pinned: false,
          incognito: false,
          windowId: 1,
        } as chrome.tabs.Tab;
        if (callback) callback([tab]);
        return Promise.resolve([tab]);
      };

      const originalSendMessage = chrome.runtime.sendMessage as (
        ...args: unknown[]
      ) => unknown;
      (chrome.runtime as { sendMessage: unknown }).sendMessage = (
        message: any,
        callback?: (response: any) => void
      ) => {
        if (message && message.type === 'TEST_CONNECTION') {
          if (callback) callback({ success: true, message: 'Test connection successful' });
          return Promise.resolve({ success: true, message: 'Test connection successful' });
        }
        return originalSendMessage.call(chrome.runtime, message, callback);
      };
    });

    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    await dismissConsentModal(page);

    await use(page);
  },
});

export { expect };
