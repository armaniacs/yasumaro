// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTimerClock } from '../../../../../testDir/waitPolicy.js';
import { createIssueReportModalController } from '../issueReportLink.js';
import type { DiagnosticsSnapshot } from '../DiagnosticsCollector.js';

/**
 * The click handler chains collectSnapshot → getLogs → Promise.race → DOM
 * write, so settling the collection takes a fixed number of microtask turns.
 * Draining a fixed tick count is deterministic (microtasks, not wall clock);
 * the count only has to cover the chain's depth.
 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

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
      // getMessageOr resolves user-facing text through chrome.i18n; an empty
      // message makes the controller fall back to its literal text.
      i18n: { getMessage: () => '' },
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
    await flushMicrotasks();

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
    await flushMicrotasks();

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
    await flushMicrotasks();
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

    // Simulates accidentally constructing the controller twice instead of
    // sharing the singleton: the second instance wires its own Open/Cancel
    // listeners, but its pendingUrl stays null so only the triggering
    // controller opens a tab.
    const controllerA = createIssueReportModalController(
      { previewModal: dom.previewModal, previewContent: dom.previewContent, cancelBtn: dom.cancelBtn, closeBtn: dom.closeBtn, openBtn: dom.openBtn },
      collectSnapshot,
    );
    createIssueReportModalController(
      { previewModal: dom.previewModal, previewContent: dom.previewContent, cancelBtn: dom.cancelBtn, closeBtn: dom.closeBtn, openBtn: dom.openBtn },
      collectSnapshot,
    );
    controllerA.attachTrigger(dom.sidebarReportBtn);

    dom.sidebarReportBtn.click();
    await flushMicrotasks();

    dom.openBtn.click();
    const create = (globalThis as unknown as { chrome: { tabs: { create: ReturnType<typeof vi.fn> } } }).chrome.tabs.create;
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('attaching the same button twice only wires one click listener', async () => {
    const dom = buildDom();
    const collectSnapshot = vi.fn().mockResolvedValue(makeSnapshot());

    const controller = createIssueReportModalController(
      { previewModal: dom.previewModal, previewContent: dom.previewContent, cancelBtn: dom.cancelBtn, closeBtn: dom.closeBtn, openBtn: dom.openBtn },
      collectSnapshot,
    );
    controller.attachTrigger(dom.sidebarReportBtn);
    controller.attachTrigger(dom.sidebarReportBtn);

    dom.sidebarReportBtn.click();
    await flushMicrotasks();

    expect(collectSnapshot).toHaveBeenCalledTimes(1);

    dom.openBtn.click();
    const create = (globalThis as unknown as { chrome: { tabs: { create: ReturnType<typeof vi.fn> } } }).chrome.tabs.create;
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('attachTrigger(null) is a no-op and does not throw', () => {
    const dom = buildDom();
    const controller = createIssueReportModalController(
      { previewModal: dom.previewModal, previewContent: dom.cancelBtn, cancelBtn: dom.cancelBtn, closeBtn: dom.closeBtn, openBtn: dom.openBtn },
      vi.fn().mockResolvedValue(makeSnapshot()),
    );
    expect(() => controller.attachTrigger(null)).not.toThrow();
  });

  it('opens the modal at click time with the collecting placeholder and Open GitHub disabled', async () => {
    const dom = buildDom();
    let resolveCollect!: (snapshot: DiagnosticsSnapshot) => void;
    const collectSnapshot = vi.fn(
      () => new Promise<DiagnosticsSnapshot>((resolve) => { resolveCollect = resolve; }),
    );

    const controller = createIssueReportModalController(
      { previewModal: dom.previewModal, previewContent: dom.previewContent, cancelBtn: dom.cancelBtn, closeBtn: dom.closeBtn, openBtn: dom.openBtn },
      collectSnapshot,
    );
    controller.attachTrigger(dom.sidebarReportBtn);

    dom.sidebarReportBtn.click();

    // Feedback is synchronous: the press must never leave the user staring
    // at an unresponsive button while collection spans awaits.
    expect(dom.previewModal.open).toBe(true);
    expect(dom.previewContent.value).toContain('Collecting diagnostics');
    expect(dom.openBtn.disabled).toBe(true);

    dom.openBtn.click();
    const create = (globalThis as unknown as { chrome: { tabs: { create: ReturnType<typeof vi.fn> } } }).chrome.tabs.create;
    expect(create).not.toHaveBeenCalled();

    resolveCollect(makeSnapshot());
    await flushMicrotasks();
    await Promise.resolve();

    expect(dom.previewContent.value).toContain('0.0.0');
    expect(dom.openBtn.disabled).toBe(false);

    dom.openBtn.click();
    expect(create).toHaveBeenCalledTimes(1);
    expect(dom.previewModal.open).toBe(false);
  });

  it('a hung collection lands in the error state at the timeout bound and the trigger recovers', async () => {
    useTimerClock();
    try {
      const dom = buildDom();
      // First press hangs forever (a wedged sub-probe); the recovery press
      // resolves so the same controller can fill the report again.
      const collectSnapshot = vi.fn()
        .mockImplementationOnce(() => new Promise<DiagnosticsSnapshot>(() => {}))
        .mockResolvedValue(makeSnapshot());

      const controller = createIssueReportModalController(
        { previewModal: dom.previewModal, previewContent: dom.previewContent, cancelBtn: dom.cancelBtn, closeBtn: dom.closeBtn, openBtn: dom.openBtn },
        collectSnapshot,
        { collectionTimeoutMs: 15_000 },
      );
      controller.attachTrigger(dom.sidebarReportBtn);

      dom.sidebarReportBtn.click();
      expect(dom.previewModal.open).toBe(true);

      vi.advanceTimersByTime(15_000);
      await flushMicrotasks();

      expect(dom.previewContent.value).toContain('Failed to prepare');
      expect(dom.openBtn.disabled).toBe(true);

      // inFlight was reset at the timeout, so Cancel + re-click starts a new
      // collection instead of returning early forever. The re-click goes
      // through the same controller — the production path re-wires nothing.
      dom.cancelBtn.click();
      expect(dom.previewModal.open).toBe(false);

      dom.sidebarReportBtn.click();
      await flushMicrotasks();

      expect(collectSnapshot).toHaveBeenCalledTimes(2);
      expect(dom.previewContent.value).toContain('0.0.0');
      expect(dom.openBtn.disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancelling during collection leaves the modal closed when the collection settles', async () => {
    const dom = buildDom();
    let resolveCollect!: (snapshot: DiagnosticsSnapshot) => void;
    const collectSnapshot = vi.fn(
      () => new Promise<DiagnosticsSnapshot>((resolve) => { resolveCollect = resolve; }),
    );

    const controller = createIssueReportModalController(
      { previewModal: dom.previewModal, previewContent: dom.previewContent, cancelBtn: dom.cancelBtn, closeBtn: dom.closeBtn, openBtn: dom.openBtn },
      collectSnapshot,
    );
    controller.attachTrigger(dom.sidebarReportBtn);

    dom.sidebarReportBtn.click();
    expect(dom.previewModal.open).toBe(true);

    dom.cancelBtn.click();
    expect(dom.previewModal.open).toBe(false);

    resolveCollect(makeSnapshot());
    await flushMicrotasks();
    await Promise.resolve();

    // The late result must not re-open the modal the user just dismissed.
    expect(dom.previewModal.open).toBe(false);
    const create = (globalThis as unknown as { chrome: { tabs: { create: ReturnType<typeof vi.fn> } } }).chrome.tabs.create;
    expect(create).not.toHaveBeenCalled();
  });
});
