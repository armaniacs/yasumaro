/**
 * Popup fixture for the cleansing-preview e2e (PBI 2026-09-11-02, round 8).
 *
 * Launch backbone (context / extensionId / pages()[0] / goto / dismiss) is
 * shared via createPopupFixture; this file only injects the preview-flow
 * differences via initScript (GET_CONTENT / PREVIEW_RECORD interception,
 * SAVE_RECORD capture) and exposes the page as previewPage.
 * tabs.query stub is tabStub: 'preview'.
 */
import { expect, Page } from '@playwright/test';
import { createPopupFixture } from './popup-shared.fixture.js';

export const MASKED_CONTENT =
  'Contact [MASKED:email] and [MASKED:phoneJp] in this article body.';

function cleansingPreviewInit(masked: unknown): void {
  (window as any).__saveRecordPayloads = [];
  (window as any).__previewRecordSeen = false;

  // Not this spec's concern — the onboarding wizard now launches
  // reactively right after the user accepts consent in the same
  // session (PBI 0913a popup.ts fix), which would otherwise cover
  // #recordBtn here. Mark onboarding done so this fixture's UI-driven
  // consent acceptance below doesn't trigger it (seeded at launch via
  // the seed policy).

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
        processedContent: masked as string,
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
    return (originalSendMessage as (...a: unknown[]) => unknown).apply(chrome.runtime, [
      message,
      callback,
    ] as unknown[]);
  } as never;
}

const baseTest = createPopupFixture({
  seedPolicy: {
    consent: true,
    settingsMigrated: true,
    onboardingCompleted: true,
  },
  tabStub: 'preview',
  initScript: { script: cleansingPreviewInit, arg: MASKED_CONTENT },
});

type PreviewFixtures = {
  previewPage: Page;
};

export const test = baseTest.extend<PreviewFixtures>({
  previewPage: async ({ popupPage }, use) => {
    // page.goto() resolving only means the 'load' event fired — initPopup()'s
    // async chain (loadCurrentTab → resetRecordButton, the sole place that
    // wires recordBtn.onclick) may still be in flight. Clicking recordBtn
    // before that wiring lands is a silent no-op: the modal then never
    // opens and the test times out waiting for it. Wait for the button to
    // reach its wired, enabled state first (this fixture's stubbed tab is
    // always recordable, so it always ends up enabled).
    await expect(popupPage.locator('#recordBtn')).toBeEnabled({ timeout: 15000 });

    await use(popupPage);
  },
});

export { expect };
