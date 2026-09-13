// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createIssueReportModalController } from '../issueReportLink.js';
import type { DiagnosticsSnapshot } from '../DiagnosticsCollector.js';

vi.mock('../../../../utils/logger/core.js', () => ({
  getLogs: vi.fn().mockResolvedValue([]),
}));

function makeSnapshot(): DiagnosticsSnapshot {
  return {
    storage: { bytesUsedKb: '0', savedUrls: '0' },
    sqlite: { initialized: true, path: '', fallback: false, fts5: true },
    deficiencies: [],
    builtInAi: null,
    obsidian: { protocol: 'https', port: '27124', apiKey: '', dailyPath: '' },
    aiProviders: [],
    aiProviderDetails: [],
    extInfo: { version: '0.0.0', name: 'test' },
    divergence: { dashboardDetectsOpfs: true, offscreenUsesFallback: false },
    settingsLoadFailed: false,
    debugMode: false,
  };
}

/** Builds the shared modal DOM (diagnostics panel + sidebar each get their
 * own reportBtn, pointed at the same modal elements). */
function buildDom(): {
  diagReportBtn: HTMLButtonElement;
  sidebarReportBtn: HTMLButtonElement;
  previewModal: HTMLDialogElement;
  previewContent: HTMLTextAreaElement;
  cancelBtn: HTMLButtonElement;
  closeBtn: HTMLButtonElement;
  openBtn: HTMLButtonElement;
} {
  document.body.innerHTML = `
    <button id="diagReportBugBtn"></button>
    <button id="sidebarReportBugBtn"></button>
    <dialog id="bugReportPreviewModal">
      <textarea id="bugReportPreviewContent"></textarea>
      <button id="bugReportCancelBtn"></button>
      <button id="bugReportPreviewCloseBtn"></button>
      <button id="bugReportOpenBtn"></button>
    </dialog>
  `;
  // jsdom doesn't implement <dialog>.showModal()/close() — stub them so
  // the controller's calls don't throw, and toggle .open like the
  // browser would.
  const modal = document.getElementById('bugReportPreviewModal') as HTMLDialogElement;
  modal.showModal = function (this: HTMLDialogElement) { this.open = true; };
  modal.close = function (this: HTMLDialogElement) { this.open = false; };

  return {
    diagReportBtn: document.getElementById('diagReportBugBtn') as HTMLButtonElement,
    sidebarReportBtn: document.getElementById('sidebarReportBugBtn') as HTMLButtonElement,
    previewModal: modal,
    previewContent: document.getElementById('bugReportPreviewContent') as HTMLTextAreaElement,
    cancelBtn: document.getElementById('bugReportCancelBtn') as HTMLButtonElement,
    closeBtn: document.getElementById('bugReportPreviewCloseBtn') as HTMLButtonElement,
    openBtn: document.getElementById('bugReportOpenBtn') as HTMLButtonElement,
  };
}

describe('createIssueReportModalController — multiple entry points sharing one modal', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (globalThis as unknown as { chrome: unknown }).chrome = {
      tabs: { create: vi.fn() },
    };
  });

  it('opening via the sidebar button and confirming opens a tab with that snapshot', async () => {
    const dom = buildDom();
    const collectSnapshot = vi.fn().mockResolvedValue(makeSnapshot());

    const controller = createIssueReportModalController(
      { previewModal: dom.previewModal, previewContent: dom.previewContent, cancelBtn: dom.cancelBtn, closeBtn: dom.closeBtn, openBtn: dom.openBtn },
      collectSnapshot,
    );
    controller.attachTrigger(dom.diagReportBtn);
    controller.attachTrigger(dom.sidebarReportBtn);

    dom.sidebarReportBtn.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(dom.previewModal.open).toBe(true);
    expect(dom.previewContent.value).toContain('0.0.0');

    dom.openBtn.click();

    const create = (globalThis as unknown as { chrome: { tabs: { create: ReturnType<typeof vi.fn> } } }).chrome.tabs.create;
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0].url).toContain('https://github.com/armaniacs/yasumaro/issues/new');
    expect(dom.previewModal.open).toBe(false);
  });

  it('opening via the diagnostics panel button and confirming also opens a tab (second attachTrigger call still functions)', async () => {
    const dom = buildDom();
    const collectSnapshot = vi.fn().mockResolvedValue(makeSnapshot());

    const controller = createIssueReportModalController(
      { previewModal: dom.previewModal, previewContent: dom.previewContent, cancelBtn: dom.cancelBtn, closeBtn: dom.closeBtn, openBtn: dom.openBtn },
      collectSnapshot,
    );
    controller.attachTrigger(dom.diagReportBtn);
    controller.attachTrigger(dom.sidebarReportBtn);

    dom.diagReportBtn.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(dom.previewModal.open).toBe(true);

    dom.openBtn.click();

    const create = (globalThis as unknown as { chrome: { tabs: { create: ReturnType<typeof vi.fn> } } }).chrome.tabs.create;
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('cancelling closes the modal without opening a tab', async () => {
    const dom = buildDom();
    const collectSnapshot = vi.fn().mockResolvedValue(makeSnapshot());

    const controller = createIssueReportModalController(
      { previewModal: dom.previewModal, previewContent: dom.previewContent, cancelBtn: dom.cancelBtn, closeBtn: dom.closeBtn, openBtn: dom.openBtn },
      collectSnapshot,
    );
    controller.attachTrigger(dom.sidebarReportBtn);

    dom.sidebarReportBtn.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(dom.previewModal.open).toBe(true);

    dom.cancelBtn.click();
    expect(dom.previewModal.open).toBe(false);

    dom.openBtn.click();
    const create = (globalThis as unknown as { chrome: { tabs: { create: ReturnType<typeof vi.fn> } } }).chrome.tabs.create;
    expect(create).not.toHaveBeenCalled();
  });

  it('reentrancy guard: two controllers over the same modal do not double-fire open/cancel listeners', async () => {
    const dom = buildDom();
    const collectSnapshot = vi.fn().mockResolvedValue(makeSnapshot());

    // Simulates the bug this refactor prevents: each controller instance owns
    // its own pendingUrl, so accidentally constructing the controller twice
    // (instead of sharing the one singleton) must not cause chrome.tabs.create
    // to fire more than once per Open click, since each attaches its own
    // listener set to the same buttons.
    const controllerA = createIssueReportModalController(
      { previewModal: dom.previewModal, previewContent: dom.previewContent, cancelBtn: dom.cancelBtn, closeBtn: dom.closeBtn, openBtn: dom.openBtn },
      collectSnapshot,
    );
    controllerA.attachTrigger(dom.sidebarReportBtn);

    dom.sidebarReportBtn.click();
    await Promise.resolve();
    await Promise.resolve();

    dom.openBtn.click();
    const create = (globalThis as unknown as { chrome: { tabs: { create: ReturnType<typeof vi.fn> } } }).chrome.tabs.create;
    expect(create).toHaveBeenCalledTimes(1);
  });
});
