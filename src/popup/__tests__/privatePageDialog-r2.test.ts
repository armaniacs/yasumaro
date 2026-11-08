// @vitest-environment jsdom
/**
 * privatePageDialog-r2.test.ts
 *
 * PBI 2026-11-08-08 (4): showing a confirmation dialog that is already open
 * must not throw (native showModal raises InvalidStateError on a second
 * show). These tests pin the open guard: a second show keeps the displayed
 * state and calls showModal exactly once.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPopupDom } from './helpers/popupDom.js';

describe('privatePageDialog', () => {
  describe('double-show guard', () => {
    beforeEach(() => {
      setupPopupDom({ includePending: false });
    });

    afterEach(async () => {
      const { focusTrapManager } = await import('../../utils/ui/focusTrap.js');
      for (const id of ['private-page-dialog', 'recording-failed-dialog']) {
        (document.getElementById(id) as HTMLDialogElement | null)?.close();
      }
      focusTrapManager.releaseAll();
    });

    it('shows the private-page dialog once when shown twice in a row', async () => {
      const mod = await import('../privatePageDialog.js');
      const dialog = document.getElementById('private-page-dialog') as HTMLDialogElement;
      const showModalSpy = vi.spyOn(dialog, 'showModal');

      mod.showPrivatePageDialog('https://example.com/a', 'auth_required', 'Basic Auth');
      expect(() =>
        mod.showPrivatePageDialog('https://example.com/b', 'auth_required', 'Basic Auth'),
      ).not.toThrow();

      expect(dialog.open).toBe(true);
      expect(showModalSpy).toHaveBeenCalledTimes(1);
      showModalSpy.mockRestore();
    });

    it('shows the recording-failed dialog once when shown twice in a row', async () => {
      const mod = await import('../privatePageDialog.js');
      const dialog = document.getElementById('recording-failed-dialog') as HTMLDialogElement;
      const showModalSpy = vi.spyOn(dialog, 'showModal');

      mod.showRecordingFailedDialog('https://example.com/a', 'Network error');
      expect(() => mod.showRecordingFailedDialog('https://example.com/b', 'Timeout')).not.toThrow();

      expect(dialog.open).toBe(true);
      expect(showModalSpy).toHaveBeenCalledTimes(1);
      showModalSpy.mockRestore();
    });
  });
});
