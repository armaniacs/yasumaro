/**
 * Popup fixture for the cleansing-preview e2e (PBI 2026-09-11-02, round 8).
 *
 * Based on popup-pbi27.fixture.ts, extended to drive the preview flow:
 * - stubs chrome.tabs.query with a fixed page tab (record target)
 * - intercepts PREVIEW_RECORD and returns canned masked content
 * - captures every SAVE_RECORD payload into window.__saveRecordPayloads
 * - passes everything else through to the real service worker
 */
import { test as base, chromium, ChromiumBrowserContext, Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXTENSION_PATH = path.join(__dirname, '../../../dist/chromium-mv3');

type PreviewFixtures = {
  context: ChromiumBrowserContext;
  extensionId: string;
  previewPage: Page;
};

export const MASKED_CONTENT =
  'Contact [MASKED:email] and [MASKED:phoneJp] in this article body.';

export const test = base.extend<PreviewFixtures>({
  context: async ({}, use) => {
    let context: ChromiumBrowserContext | null = null;
    try {
      context = await chromium.launchPersistentContext('', {
        channel: 'chromium',
        args: [
          `--disable-extensions-except=${EXTENSION_PATH}`,
          `--load-extension=${EXTENSION_PATH}`,
        ],
      });
      const [serviceWorker] = context.serviceWorkers();
      if (!serviceWorker) {
        await Promise.race([
          context.waitForEvent('serviceworker').then(() => true),
          new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
        ]).then(async (started) => {
          if (!started) {
            await context?.close().catch(() => undefined);
            context = null;
          }
        });
      }
    } catch {
      context = null;
    }
    if (!context) {
      test.fixme(true, 'Extension tests require headed Chrome (Manifest V3 service workers unsupported in headless)');
      return;
    }
    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    }
    await use(serviceWorker.url().split('/')[2] ?? '');
  },

  previewPage: async ({ context, extensionId }, use) => {
    const pages = context.pages();
    const page: Page = pages[0] ?? (await context.newPage());

    await page.addInitScript((masked: string) => {
      (window as any).__saveRecordPayloads = [];
      (window as any).__previewRecordSeen = false;

      chrome.storage.local.set({
        privacyConsent: { accepted: true, timestamp: Date.now() },
        settings_migrated: true,
      });

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

    // Dismiss the consent modal if present.
    const consentModal = page.locator('#privacyConsentModal');
    if (await consentModal.isVisible().catch(() => false)) {
      await page.locator('#consentCheckbox').check();
      await page.locator('#acceptConsentBtn').click();
    }

    await use(page);
  },
});

