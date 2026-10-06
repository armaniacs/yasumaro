/**
 * Shared popup-launch skeleton for the popup E2E fixtures.
 *
 * Unifies the triplicated context / extensionId / pages()[0] / goto /
 * dismiss backbone previously copy-pasted across popup.fixture.ts,
 * popup-pbi27.fixture.ts and cleansing-preview.fixture.ts. Per-spec
 * differences (tabs.create recording, GET_CONTENT / PREVIEW_RECORD
 * interception) are injected via `initScript`, and the presence of the
 * chrome.tabs.query stub is explicit via `tabStub`.
 */
import { test as base, Page } from '@playwright/test';
import type { ChromiumBrowserContext } from 'playwright';
import { dismissConsentModal } from './consentModal.js';
import {
  launchExtensionContext,
  resolveExtensionId,
  HEADLESS_FIXME_MESSAGE,
  type ExtensionSeedPolicy,
} from './launchExtensionContext.js';

/**
 * chrome.tabs.query stub selection. The name makes the stub's presence
 * explicit at each call site:
 * - 'none': no tabs.query stub (popup.fixture.ts behaviour)
 * - 'example': fixed example.com tab (popup-pbi27.fixture.ts behaviour)
 * - 'preview': fixed preview-e2e tab (cleansing-preview.fixture.ts behaviour)
 */
export type PopupTabStub = 'none' | 'example' | 'preview';

/** Extra per-spec browser stub injected after the common stubs. */
export type PopupInitScript = {
  script: (arg: unknown) => void;
  arg?: unknown;
};

export type CreatePopupFixtureOptions = {
  seedPolicy: ExtensionSeedPolicy;
  tabStub?: PopupTabStub;
  initScript?: PopupInitScript;
};

export type PopupFixtures = {
  context: ChromiumBrowserContext;
  extensionId: string;
  popupPage: Page;
};

function commonPopupInit(tabStub: PopupTabStub): void {
  if (tabStub === 'example') {
    chrome.tabs.query = (_queryInfo: unknown, callback?: (result: chrome.tabs.Tab[]) => void) => {
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
  } else if (tabStub === 'preview') {
    chrome.tabs.query = (_queryInfo: unknown, callback?: (result: chrome.tabs.Tab[]) => void) => {
      const tab = {
        id: 7,
        url: 'https://preview-e2e.test/article',
        title: 'Preview e2e article',
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
  }

  const originalSendMessage = chrome.runtime.sendMessage as (...args: unknown[]) => unknown;
  (chrome.runtime as { sendMessage: unknown }).sendMessage = (message: unknown, callback?: (response: unknown) => void) => {
    if (message && (message as { type?: string }).type === 'TEST_CONNECTION') {
      const response = { success: true, message: 'Test connection successful' };
      if (callback) callback(response);
      return Promise.resolve(response);
    }
    return (originalSendMessage as (...a: unknown[]) => unknown).call(chrome.runtime, message, callback);
  };
}

export function createPopupFixture(options: CreatePopupFixtureOptions) {
  const { seedPolicy, tabStub = 'none', initScript } = options;

  const test = base.extend<PopupFixtures>({
    context: async ({}, use) => {
      const context = await launchExtensionContext({ seedPolicy });
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
      // Use existing page or create new one
      const pages = context.pages();
      const page: Page = pages[0] ?? (await context.newPage());

      // Capture console logs for debugging
      page.on('console', msg => {
        console.log(`[Popup Console] ${msg.type()}: ${msg.text()}`);
      });

      await page.addInitScript(commonPopupInit, tabStub);
      if (initScript) {
        await page.addInitScript(initScript.script, initScript.arg);
      }

      await page.goto(`chrome-extension://${extensionId}/popup.html`);

      await dismissConsentModal(page);

      await use(page);
    },
  });

  return test;
}
