// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForMock, drainMacrotask } from '../../../testDir/waitPolicy.js';

const chromeMock = {
  runtime: {
    getURL: vi.fn(() => 'chrome-extension://test/icons/icon48.png'),
  },
  i18n: {
    getMessage: vi.fn((key: string, args?: string[]) => {
      const messages: Record<string, string> = {
        notifyPrivacyConfirmTitle: 'Privacy Confirmation',
        privacyDialogBody: 'This page has privacy concerns ({0}). Save anyway?',
        notifyPrivacyConfirmSave: 'Save',
        cancel: 'Cancel',
        privacyDialogStatusLabel: 'Status Code',
      };
      if (args && messages[key]) {
        return messages[key]!.replace('{0}', String(args[0] ?? ''));
      }
      return messages[key] || '';
    }),
  },
};

vi.stubGlobal('chrome', chromeMock);

import { showPrivacyConfirmDialog } from '../privacyDialog.js';

describe('privacyDialog', () => {
  describe('showPrivacyConfirmDialog', () => {
    let capturedShadow: ShadowRoot | null = null;
    const originalAttachShadow = HTMLElement.prototype.attachShadow;

    beforeEach(() => {
      document.body.innerHTML = '';
      vi.clearAllMocks();
      vi.spyOn(HTMLElement.prototype, 'attachShadow').mockImplementation(function (
        this: HTMLElement,
        init: ShadowRootInit,
      ) {
        const shadow = originalAttachShadow.call(this, { ...init, mode: 'open' });
        capturedShadow = shadow;
        return shadow;
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
      capturedShadow = null;
      document.querySelectorAll('#osh-privacy-confirm-host').forEach((el) => el.remove());
    });

    it('settles false via cleanup when host is removed externally', async () => {
      let finallyRan = false;
      const promise = showPrivacyConfirmDialog('S001', 'Test reason').finally(() => {
        finallyRan = true;
      });

      document.getElementById('osh-privacy-confirm-host')?.remove();

      await waitForMock(() => {
        expect(document.getElementById('osh-privacy-confirm-host')).toBeNull();
      });
      const result = await promise;
      expect(result).toBe(false);
      expect(finallyRan).toBe(true);
    });

    it('does not double settle after host removal', async () => {
      const promise = showPrivacyConfirmDialog('S002', 'Test reason');
      const shadow = capturedShadow as unknown as ShadowRoot;

      document.getElementById('osh-privacy-confirm-host')?.remove();
      const first = await promise;
      expect(first).toBe(false);

      (shadow.getElementById('osh-save') as HTMLButtonElement)?.click();
      await drainMacrotask();
      await expect(promise).resolves.toBe(false);
    });

    it('resolves true on save click', async () => {
      const promise = showPrivacyConfirmDialog('S003', 'Test reason');
      const shadow = capturedShadow as unknown as ShadowRoot;
      (shadow.getElementById('osh-save') as HTMLButtonElement)?.click();
      await expect(promise).resolves.toBe(true);
      expect(document.getElementById('osh-privacy-confirm-host')).toBeNull();
    });

    it('resolves false on cancel click', async () => {
      const promise = showPrivacyConfirmDialog('S004', 'Test reason');
      const shadow = capturedShadow as unknown as ShadowRoot;
      (shadow.getElementById('osh-cancel') as HTMLButtonElement)?.click();
      await expect(promise).resolves.toBe(false);
      expect(document.getElementById('osh-privacy-confirm-host')).toBeNull();
    });

    it('resolves false on overlay click and ignores clicks inside dialog', async () => {
      const promise = showPrivacyConfirmDialog('S005', 'Overlay click');
      const shadow = capturedShadow as unknown as ShadowRoot;
      const dialog = shadow.querySelector('.dialog') as HTMLDivElement;
      const insideClick = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(insideClick, 'target', { value: dialog, writable: false });
      dialog.dispatchEvent(insideClick);
      await drainMacrotask();
      expect(document.getElementById('osh-privacy-confirm-host')).not.toBeNull();

      const overlay = shadow.querySelector('.overlay') as HTMLDivElement;
      const overlayClick = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(overlayClick, 'target', { value: overlay, writable: false });
      overlay.dispatchEvent(overlayClick);
      await expect(promise).resolves.toBe(false);
      expect(document.getElementById('osh-privacy-confirm-host')).toBeNull();
    });
  });
});
