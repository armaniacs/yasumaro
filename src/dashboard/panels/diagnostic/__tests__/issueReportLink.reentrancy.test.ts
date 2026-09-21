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

function buildDom() {
  document.body.innerHTML = `
    <button id="reportBugBtn"></button>
    <dialog id="bugReportPreviewModal">
      <textarea id="bugReportPreviewContent"></textarea>
      <button id="bugReportCancelBtn"></button>
      <button id="bugReportPreviewCloseBtn"></button>
      <button id="bugReportOpenBtn"></button>
    </dialog>
  `;
  const modal = document.getElementById('bugReportPreviewModal') as HTMLDialogElement;
  // Mirror the real browser: showModal() on an open dialog throws InvalidStateError.
  modal.showModal = function (this: HTMLDialogElement) {
    if (this.open) {
      throw new DOMException(
        "Failed to execute 'showModal' on 'HTMLDialogElement': The element already has an 'open' attribute, and therefore cannot be opened modally.",
        'InvalidStateError',
      );
    }
    this.open = true;
  };
  modal.close = function (this: HTMLDialogElement) {
    this.open = false;
  };

  return {
    reportBtn: document.getElementById('reportBugBtn') as HTMLButtonElement,
    previewModal: modal,
    previewContent: document.getElementById('bugReportPreviewContent') as HTMLTextAreaElement,
    cancelBtn: document.getElementById('bugReportCancelBtn') as HTMLButtonElement,
    closeBtn: document.getElementById('bugReportPreviewCloseBtn') as HTMLButtonElement,
    openBtn: document.getElementById('bugReportOpenBtn') as HTMLButtonElement,
  };
}

function flush(times = 10): Promise<void> {
  let p = Promise.resolve();
  for (let i = 0; i < times; i += 1) {
    p = p.then(() => Promise.resolve());
  }
  return p;
}

describe('issueReportLink reentrancy (PBI 2026-09-21-07)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (globalThis as unknown as { chrome: unknown }).chrome = {
      tabs: { create: vi.fn() },
      // getMessageOr falls back when the key resolves empty.
      i18n: { getMessage: vi.fn().mockReturnValue('') },
    };
  });

  it('pins current behavior: single click opens modal with preview', async () => {
    const dom = buildDom();
    const collectSnapshot = vi.fn().mockResolvedValue(makeSnapshot());
    const controller = createIssueReportModalController(
      {
        previewModal: dom.previewModal,
        previewContent: dom.previewContent,
        cancelBtn: dom.cancelBtn,
        closeBtn: dom.closeBtn,
        openBtn: dom.openBtn,
      },
      collectSnapshot,
    );
    controller.attachTrigger(dom.reportBtn);

    dom.reportBtn.click();
    await flush();

    expect(collectSnapshot).toHaveBeenCalledTimes(1);
    expect(dom.previewModal.open).toBe(true);
    expect(dom.previewContent.value).toContain('0.0.0');
  });

  it('gap: rapid double click runs collection once and never throws InvalidStateError', async () => {
    const dom = buildDom();
    let resolveSnapshot!: (v: DiagnosticsSnapshot) => void;
    const collectSnapshot = vi.fn(
      () =>
        new Promise<DiagnosticsSnapshot>((resolve) => {
          resolveSnapshot = resolve;
        }),
    );
    const controller = createIssueReportModalController(
      {
        previewModal: dom.previewModal,
        previewContent: dom.previewContent,
        cancelBtn: dom.cancelBtn,
        closeBtn: dom.closeBtn,
        openBtn: dom.openBtn,
      },
      collectSnapshot,
    );
    controller.attachTrigger(dom.reportBtn);

    dom.reportBtn.click();
    dom.reportBtn.click();
    resolveSnapshot(makeSnapshot());
    await flush(20);

    // Second trigger while in flight must be ignored — no InvalidStateError,
    // no unhandled rejection, single collection.
    expect(collectSnapshot).toHaveBeenCalledTimes(1);
    expect(dom.previewModal.open).toBe(true);
  });

  it('gap: collectSnapshot rejection is caught and shown user-visibly, button re-enabled', async () => {
    const dom = buildDom();
    const collectSnapshot = vi.fn().mockRejectedValue(new Error('boom'));
    const controller = createIssueReportModalController(
      {
        previewModal: dom.previewModal,
        previewContent: dom.previewContent,
        cancelBtn: dom.cancelBtn,
        closeBtn: dom.closeBtn,
        openBtn: dom.openBtn,
      },
      collectSnapshot,
    );
    controller.attachTrigger(dom.reportBtn);

    // Must not produce an unhandled rejection.
    dom.reportBtn.click();
    await flush(20);

    // User-visible error status, no sensitive data, button usable again.
    expect(dom.previewContent.value.length).toBeGreaterThan(0);
    expect(dom.previewContent.value).not.toContain('boom-secret-should-never-appear');
    expect(dom.reportBtn.disabled).toBe(false);
    const create = (
      globalThis as unknown as { chrome: { tabs: { create: ReturnType<typeof vi.fn> } } }
    ).chrome.tabs.create;
    dom.openBtn.click();
    expect(create).not.toHaveBeenCalled();
  });

  it('gap: clicking while the modal is already open does not throw', async () => {
    const dom = buildDom();
    const collectSnapshot = vi.fn().mockResolvedValue(makeSnapshot());
    const controller = createIssueReportModalController(
      {
        previewModal: dom.previewModal,
        previewContent: dom.previewContent,
        cancelBtn: dom.cancelBtn,
        closeBtn: dom.closeBtn,
        openBtn: dom.openBtn,
      },
      collectSnapshot,
    );
    controller.attachTrigger(dom.reportBtn);

    dom.reportBtn.click();
    await flush();
    expect(dom.previewModal.open).toBe(true);

    // collectSnapshot resolves immediately here, so without an open-modal
    // guard the second click would call showModal() on the open dialog and
    // throw InvalidStateError (unhandled rejection).
    dom.reportBtn.click();
    await flush(20);

    expect(dom.previewModal.open).toBe(true);
    expect(collectSnapshot).toHaveBeenCalledTimes(1);
  });
});
