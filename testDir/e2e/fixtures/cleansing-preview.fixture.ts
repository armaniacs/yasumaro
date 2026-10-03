/**
 * Popup fixture for the cleansing-preview e2e (PBI 2026-09-11-02, round 8).
 *
 * Based on popup-pbi27.fixture.ts, extended to drive the preview flow:
 * - stubs chrome.tabs.query with a fixed page tab (record target)
 * - intercepts PREVIEW_RECORD and returns canned masked content
 * - captures every SAVE_RECORD payload into window.__saveRecordPayloads
 * - passes everything else through to the real service worker
 */
import { test as base, expect, Page } from '@playwright/test';
import type { ChromiumBrowserContext } from 'playwright';
import { dismissConsentModal } from './consentModal.js';
import {
  launchExtensionContext,
  resolveExtensionId,
  HEADLESS_FIXME_MESSAGE,
} from './launchExtensionContext.js';

type PreviewFixtures = {
  context: ChromiumBrowserContext;
  extensionId: string;
  previewPage: Page;
};

export const MASKED_CONTENT =
  'Contact [MASKED:email] and [MASKED:phoneJp] in this article body.';

export const test = base.extend<PreviewFixtures>({
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

  previewPage: async ({ context, extensionId }, use) => {
    const pages = context.pages();
    const page: Page = pages[0] ?? (await context.newPage());

    await page.addInitScript((masked: string) => {
      (window as any).__saveRecordPayloads = [];
      (window as any).__previewRecordSeen = false;

      // Not this spec's concern — the onboarding wizard now launches
      // reactively right after the user accepts consent in the same
      // session (PBI 0913a popup.ts fix), which would otherwise cover
      // #recordBtn here. Mark onboarding done so this fixture's UI-driven
      // consent acceptance below doesn't trigger it (seeded at launch via
      // the seed policy).

      // Fixed page tab: the record target for this spec.
      chrome.tabs.query = (_queryInfo: any, callback?: (result: chrome.tabs.Tab[]) => void) => {
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

      // ContentFetchGateway.fetch() asks the tab's content script via
      // chrome.tabs.sendMessage({ type: 'GET_CONTENT' }) before falling back
      // to the permission ladder. Tab id 7 is fake (no real content script),
      // so without this stub the fetch always rejects, runNormalBranch's
      // non-force path throws, and the preview modal never opens.
      chrome.tabs.sendMessage = ((_tabId: number, message: any) => {
        if (message && message.type === 'GET_CONTENT') {
          return Promise.resolve({ content: 'raw fetched content' });
        }
        return Promise.resolve(undefined);
      }) as typeof chrome.tabs.sendMessage;

      window.close = () => {
        (window as any).__closeCalled = true;
      };

      const originalSendMessage = (chrome.runtime as unknown as {
        sendMessage: (...args: unknown[]) => unknown;
      }).sendMessage;
      (chrome.runtime as unknown as { sendMessage: unknown }).sendMessage = function (
        this: unknown,
        message: any,
        callback?: (response: any) => void
      ) {
        if (message && message.type === 'PREVIEW_RECORD') {
          (window as any).__previewRecordSeen = true;
          const response = {
            success: true,
            processedContent: masked,
            maskedItems: [
              { type: 'email', start: 8, end: 23 },
              { type: 'phoneJp', start: 28, end: 42 },
            ],
            maskedCount: 2,
            cleansedReason: 'both',
            cleanseStats: { hardStripRemoved: 1, keywordStripRemoved: 2, totalRemoved: 3 },
          };
          if (callback) callback(response);
          return Promise.resolve(response);
        }
        if (message && message.type === 'SAVE_RECORD') {
          (window as any).__saveRecordPayloads.push(message.payload ?? message);
          const response = { success: true };
          if (callback) callback(response);
          return Promise.resolve(response);
        }
        if (message && message.type === 'TEST_CONNECTION') {
          const response = { success: true, message: 'ok' };
          if (callback) callback(response);
          return Promise.resolve(response);
        }
        return (originalSendMessage as (...a: unknown[]) => unknown).apply(chrome.runtime, [
          message,
          callback,
        ] as unknown[]);
      } as never;
    }, MASKED_CONTENT);

    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    await dismissConsentModal(page);

    // page.goto() resolving only means the 'load' event fired — initPopup()'s
    // async chain (loadCurrentTab → resetRecordButton, the sole place that
    // wires recordBtn.onclick) may still be in flight. Clicking recordBtn
    // before that wiring lands is a silent no-op: the modal then never
    // opens and the test times out waiting for it. Wait for the button to
    // reach its wired, enabled state first (this fixture's stubbed tab is
    // always recordable, so it always ends up enabled).
    await expect(page.locator('#recordBtn')).toBeEnabled({ timeout: 15000 });

    await use(page);
  },
});
