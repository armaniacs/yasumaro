// @vitest-environment jsdom
import { describe, test, expect, vi, afterEach } from 'vitest';

/**
 * PBI 2026-09-11-03 (round 6): preview settlement tests — every path that
 * ends a preview must settle the caller's promise exactly once. The old
 * handleAction missing-DOM path nulled the callbacks without settling:
 * the record flow's only permanent-hang path.
 */
import * as sanitizePreview from '../sanitizePreview.js';
import { focusTrapManager } from '../../utils/ui/focusTrap.js';

function setupModalDOM(): void {
  document.body.innerHTML = `
    <dialog id="confirmationModal">
      <div class="modal-body">
        <div id="cleansingInfo" class="hidden"><span id="cleansingBadge"></span></div>
        <div id="maskNavAnchor"></div>
        <textarea id="previewContent"></textarea>
      </div>
      <button id="closeModalBtn">×</button>
      <button id="cancelPreviewBtn">Cancel</button>
      <button id="confirmPreviewBtn">Confirm</button>
    </dialog>
  `;
  const dialog = document.getElementById('confirmationModal') as HTMLDialogElement & {
    showModal?: () => void;
    close?: () => void;
  };
  dialog.showModal = function () {
    this.open = true;
  };
  dialog.close = function () {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
}

function trapCountFor(modal: HTMLElement): number {
  return [...focusTrapManager.handlers.values()].filter((h) => h.element === modal).length;
}

/** Races a promise against a watchdog — hangs surface as 'timeout'. */
function withWatchdog<T>(promise: Promise<T>, ms = 250): Promise<
  { kind: 'resolved'; value: T } | { kind: 'rejected'; value: unknown } | { kind: 'timeout' }
> {
  return Promise.race([
    promise.then(
      (value) => ({ kind: 'resolved' as const, value }),
      (value: unknown) => ({ kind: 'rejected' as const, value })
    ),
    new Promise<{ kind: 'timeout' }>((resolve) => setTimeout(() => resolve({ kind: 'timeout' }), ms)),
  ]);
}

describe('preview settlement (PBI 2026-09-11-03)', () => {
  afterEach(() => {
    sanitizePreview.cleanupModalEvents();
    document.body.innerHTML = '';
    focusTrapManager.releaseAll();
  });

  test('rejects instead of hanging when the modal disappears before confirm', async () => {
    setupModalDOM();
    const loggerModule = await import('../../utils/logger.js');
    const logErrorSpy = vi.spyOn(loggerModule, 'logError').mockImplementation(() => Promise.resolve());
    const promise = sanitizePreview.showPreview('content');
    // DOM teardown between show and user action — the confirm button survives
    // as a detached node carrying its click listener.
    const confirmBtn = document.getElementById('confirmPreviewBtn') as HTMLButtonElement;
    document.body.innerHTML = '';

    confirmBtn.click();
    const outcome = await withWatchdog(promise);

    // PBI 2026-09-11-03: must settle (reject), never hang.
    expect(outcome.kind).toBe('rejected');
    if (outcome.kind === 'rejected') {
      expect((outcome.value as Error).message).toContain('not found in DOM');
    }
    expect(logErrorSpy).toHaveBeenCalled();
    logErrorSpy.mockRestore();
  });

  test('settles exactly once when close fires after confirm', async () => {
    setupModalDOM();
    const promise = sanitizePreview.showPreview('content');
    (document.getElementById('confirmPreviewBtn') as HTMLButtonElement).click();
    // boundHandleClose fires synchronously from modal.close() inside
    // handleAction — its null-guard must absorb it (single-settle).
    (document.getElementById('closeModalBtn') as HTMLButtonElement).click();
    const outcome = await withWatchdog(promise);
    expect(outcome.kind).toBe('resolved');
    if (outcome.kind === 'resolved') {
      expect(outcome.value).toEqual({ confirmed: true, content: 'content' });
    }
  });

  test('focusTrap live-trap count stays at zero after each show/settle cycle', async () => {
    for (let i = 0; i < 5; i++) {
      setupModalDOM();
      const promise = sanitizePreview.showPreview('c' + i);
      const modal = document.getElementById('confirmationModal') as HTMLDialogElement;
      expect(trapCountFor(modal)).toBe(1);
      (document.getElementById('confirmPreviewBtn') as HTMLButtonElement).click();
      const result = await withWatchdog(promise, 500);
      expect(result.kind).toBe('resolved');
      expect(trapCountFor(modal)).toBe(0);
    }
  });
});
