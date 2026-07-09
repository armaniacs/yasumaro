// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { showConfirmDialog } from '../confirmDialog.js';

describe('showConfirmDialog', () => {
  let prevFocus: HTMLElement;

  beforeEach(() => {
    prevFocus = document.createElement('button');
    prevFocus.id = 'prev-focus';
    document.body.appendChild(prevFocus);
    prevFocus.focus();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('creates dialog elements with title, message, and buttons in DOM', async () => {
    const promise = showConfirmDialog({ title: 'My Title', message: 'My Message' });

    const overlay = document.querySelector('.confirm-dialog-overlay');
    const dialog = document.querySelector('.confirm-dialog');
    const titleEl = document.getElementById('confirm-dialog-title');
    const msgEl = document.getElementById('confirm-dialog-message');

    expect(overlay).not.toBeNull();
    expect(dialog).not.toBeNull();
    expect(titleEl?.textContent).toBe('My Title');
    expect(msgEl?.textContent).toBe('My Message');
    expect(overlay?.getAttribute('role')).toBe('dialog');
    expect(overlay?.getAttribute('aria-modal')).toBe('true');
    expect(overlay?.getAttribute('aria-labelledby')).toBe('confirm-dialog-title');
    expect(overlay?.getAttribute('aria-describedby')).toBe('confirm-dialog-message');

    document.querySelector('.confirm-dialog-btn-cancel')?.click();
    await promise;
  });

  it('resolves true on confirm click', async () => {
    const promise = showConfirmDialog({ title: 'T', message: 'M' });
    document.querySelector('.confirm-dialog-btn-primary')?.click();
    await expect(promise).resolves.toBe(true);
  });

  it('resolves false on cancel click', async () => {
    const promise = showConfirmDialog({ title: 'T', message: 'M' });
    document.querySelector('.confirm-dialog-btn-cancel')?.click();
    await expect(promise).resolves.toBe(false);
  });

  it('resolves false on Escape key', async () => {
    const promise = showConfirmDialog({ title: 'T', message: 'M' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await expect(promise).resolves.toBe(false);
  });

  it('resolves false on overlay backdrop click', async () => {
    const promise = showConfirmDialog({ title: 'T', message: 'M' });
    (document.querySelector('.confirm-dialog-overlay') as HTMLElement).click();
    await expect(promise).resolves.toBe(false);
  });

  it('does NOT resolve when clicking inside the dialog (not overlay)', async () => {
    let resolved = false;
    const promise = showConfirmDialog({ title: 'T', message: 'M' });
    promise.then(() => { resolved = true; });

    const dialog = document.querySelector('.confirm-dialog') as HTMLElement;
    dialog.click();
    await new Promise(r => setTimeout(r, 10));
    expect(resolved).toBe(false);

    document.querySelector('.confirm-dialog-btn-cancel')?.click();
    await promise;
  });

  it('uses default button texts when no custom labels', async () => {
    const promise = showConfirmDialog({ title: 'T', message: 'M' });

    expect(document.querySelector('.confirm-dialog-btn-cancel')?.textContent).toBe('Cancel');
    expect(document.querySelector('.confirm-dialog-btn-primary')?.textContent).toBe('confirmDelete');

    document.querySelector('.confirm-dialog-btn-cancel')?.click();
    await promise;
  });

  it('uses custom confirmLabel when provided (non-dangerous)', async () => {
    const promise = showConfirmDialog({ title: 'T', message: 'M', confirmLabel: 'Remove' });
    expect(document.querySelector('.confirm-dialog-btn-primary')?.textContent).toBe('Remove');
    document.querySelector('.confirm-dialog-btn-primary')?.click();
    await promise;
  });

  it('passes cancelLabel as substitution to chrome.i18n.getMessage', async () => {
    const getMessage = vi.mocked(chrome.i18n.getMessage);

    const promise = showConfirmDialog({ title: 'T', message: 'M', cancelLabel: 'Abbrechen' });
    expect(getMessage).toHaveBeenCalledWith('cancel', 'Abbrechen');
    document.querySelector('.confirm-dialog-btn-cancel')?.click();
    await promise;
  });

  it('sets danger class on dialog and confirm button when dangerous is true', async () => {
    const promise = showConfirmDialog({ title: 'T', message: 'M', dangerous: true });

    expect(document.querySelector('.confirm-dialog')?.className).toContain('confirm-dialog-danger');
    expect(document.querySelector('.confirm-dialog-btn-danger')).not.toBeNull();

    document.querySelector('.confirm-dialog-btn-danger')?.click();
    await promise;
  });

  it('does not set danger classes when dangerous is false', async () => {
    const promise = showConfirmDialog({ title: 'T', message: 'M', dangerous: false });

    expect(document.querySelector('.confirm-dialog')?.className).not.toContain('confirm-dialog-danger');
    expect(document.querySelector('.confirm-dialog-btn-danger')).toBeNull();

    document.querySelector('.confirm-dialog-btn-cancel')?.click();
    await promise;
  });

  it('restores previous active element after closing', async () => {
    expect(document.activeElement).toBe(prevFocus);

    const promise = showConfirmDialog({ title: 'T', message: 'M' });

    document.querySelector('.confirm-dialog-btn-cancel')?.click();
    await promise;

    expect(document.activeElement).toBe(prevFocus);
  });

  it('removes overlay from DOM after closing', async () => {
    const promise = showConfirmDialog({ title: 'T', message: 'M' });
    document.querySelector('.confirm-dialog-btn-cancel')?.click();
    await promise;

    expect(document.querySelector('.confirm-dialog-overlay')).toBeNull();
    expect(document.querySelector('.confirm-dialog')).toBeNull();
  });

  it('cleanup does not throw on subsequent Escape dispatch', async () => {
    const promise = showConfirmDialog({ title: 'T', message: 'M' });
    document.querySelector('.confirm-dialog-btn-cancel')?.click();
    await promise;

    expect(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }).not.toThrow();
  });

  describe('focus trap', () => {
    function getButtons(): [HTMLElement, HTMLElement] {
      const cancel = document.querySelector('.confirm-dialog-btn-cancel')! as HTMLElement;
      const confirm = document.querySelector('.confirm-dialog-btn-primary')! as HTMLElement;
      return [cancel, confirm];
    }

    it('initially focuses confirm button', async () => {
      const promise = showConfirmDialog({ title: 'T', message: 'M' });
      const [, confirm] = getButtons();
      expect(document.activeElement).toBe(confirm);
      confirm.click();
      await promise;
    });

    it('wraps focus from first to last on Shift+Tab', async () => {
      const promise = showConfirmDialog({ title: 'T', message: 'M' });
      const [cancel, confirm] = getButtons();

      cancel.focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(confirm);

      confirm.click();
      await promise;
    });

    it('wraps focus from last to first on Tab', async () => {
      const promise = showConfirmDialog({ title: 'T', message: 'M' });
      const [cancel, confirm] = getButtons();

      confirm.focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: false, bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(cancel);

      cancel.click();
      await promise;
    });
  });
});
