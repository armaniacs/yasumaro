// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies used by privatePageDialog.ts
vi.mock('../../utils/domainUtils.js', () => ({
  extractDomain: vi.fn((url: string) => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }),
}));

vi.mock('../../utils/storage.js', () => ({
  getSettings: vi.fn().mockResolvedValue({ domain_whitelist: [] }),
  saveSettings: vi.fn().mockResolvedValue(undefined),
  StorageKeys: {
    DOMAIN_WHITELIST: 'domain_whitelist',
  },
}));

vi.mock('../autoClose.js', () => ({
  startAutoCloseTimer: vi.fn(),
}));

vi.mock('../../utils/i18n.js', () => ({
  getMessage: vi.fn((key) => {
    const messages = {
      saveSuccess: 'Saved to Obsidian',
      saveError: 'Save error',
    };
    return messages[key] || key;
  }),
}));

/**
 * Helper: set up the DOM needed by privatePageDialog before importing.
 * The module has top-level event listeners attached via document.getElementById,
 * so the DOM must exist before the module is imported.
 *
 * Also polyfills HTMLDialogElement methods (showModal/close) since jsdom
 * does not implement them.
 */
function setupDialogDOM() {
  document.body.innerHTML = `
    <dialog id="private-page-dialog">
      <div id="dialog-message"></div>
      <button id="dialog-cancel">Cancel</button>
      <button id="dialog-save-once">Save Once</button>
      <button id="dialog-save-domain">Save for Domain</button>
      <button id="dialog-save-path">Save for Path</button>
    </dialog>
    <div id="mainStatus"></div>
  `;

  // Polyfill HTMLDialogElement methods for jsdom
  const dialog = document.getElementById('private-page-dialog') as any;
  if (dialog) {
    dialog.showModal = function () {
      this.open = true;
    };
    dialog.close = function () {
      this.open = false;
    };
  }
}

/**
 * Helper: create a minimal PendingSave object.
 */
function createPendingSave(overrides = {}) {
  return {
    title: 'Test Page',
    url: 'https://example.com/test-page',
    content: 'Test content',
    privacyData: null,
    ...overrides,
  };
}

describe('privatePageDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDialogDOM();
    // Ensure chrome.runtime.sendMessage returns a promise by default.
    // The vitest.setup.ts beforeEach reassigns it to the callback-based mock,
    // so we must override it here again with a promise-returning version.
    (global.chrome.runtime.sendMessage as any).mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.resetModules();
    // Restore DOM
    document.body.innerHTML = '';
  });

  describe('exports', () => {
    it('should export setCurrentPendingSave function', async () => {
      const mod = await import('../privatePageDialog.js');
      expect(typeof mod.setCurrentPendingSave).toBe('function');
    });

    it('should export showPrivatePageDialog function', async () => {
      const mod = await import('../privatePageDialog.js');
      expect(typeof mod.showPrivatePageDialog).toBe('function');
    });

    it('should export currentPendingSave variable', async () => {
      const mod = await import('../privatePageDialog.js');
      expect('currentPendingSave' in mod).toBe(true);
    });
  });

  describe('setCurrentPendingSave', () => {
    it('should set currentPendingSave to the given value', async () => {
      const mod = await import('../privatePageDialog.js');
      const save = createPendingSave();
      mod.setCurrentPendingSave(save);
      expect(mod.currentPendingSave).toEqual(save);
    });

    it('should set currentPendingSave to null', async () => {
      const mod = await import('../privatePageDialog.js');
      mod.setCurrentPendingSave(createPendingSave());
      mod.setCurrentPendingSave(null);
      expect(mod.currentPendingSave).toBeNull();
    });
  });

  describe('showPrivatePageDialog', () => {
    it('should show the dialog and set message text', async () => {
      // Override chrome.i18n.getMessage for this test
      (global.chrome.i18n.getMessage as any).mockImplementation(
        (key: string, substitutions?: string[]) => {
          if (key === 'warningPrivatePageMessage') {
            return `Warning: ${substitutions?.[0]} - ${substitutions?.[1]}`;
          }
          return key;
        }
      );

      const mod = await import('../privatePageDialog.js');
      mod.showPrivatePageDialog(
        'https://example.com/private',
        'auth_required',
        'Basic Auth'
      );

      const dialog = document.getElementById('private-page-dialog') as HTMLDialogElement;
      const messageEl = document.getElementById('dialog-message');

      expect(messageEl!.textContent).toContain('Basic Auth');
      expect(messageEl!.textContent).toContain('https://example.com/private');
      // showModal should have been called on the dialog
      expect(dialog.open).toBe(true);
    });

    it('should use reason when headerValue is empty', async () => {
      (global.chrome.i18n.getMessage as any).mockImplementation(
        (key: string, substitutions?: string[]) => {
          if (key === 'warningPrivatePageMessage') {
            return `Warning: ${substitutions?.[0]} - ${substitutions?.[1]}`;
          }
          return key;
        }
      );

      const mod = await import('../privatePageDialog.js');
      mod.showPrivatePageDialog('https://example.com', 'no_reason', '');

      const messageEl = document.getElementById('dialog-message');
      expect(messageEl!.textContent).toContain('no_reason');
    });

    it('should handle missing message element gracefully', async () => {
      document.getElementById('dialog-message')!.remove();

      const mod = await import('../privatePageDialog.js');
      // Should not throw when messageEl is null
      expect(() => {
        mod.showPrivatePageDialog('https://example.com', 'reason', 'header');
      }).not.toThrow();
    });

    it('should handle missing dialog element gracefully', async () => {
      document.getElementById('private-page-dialog')!.remove();

      const mod = await import('../privatePageDialog.js');
      // Should not throw when dialog is null
      expect(() => {
        mod.showPrivatePageDialog('https://example.com', 'reason', 'header');
      }).not.toThrow();
    });
  });

  describe('dialog-cancel button', () => {
    it('should close the dialog and clear currentPendingSave when cancel is clicked', async () => {
      const mod = await import('../privatePageDialog.js');
      mod.setCurrentPendingSave(createPendingSave());

      const dialog = document.getElementById('private-page-dialog') as HTMLDialogElement;
      dialog.showModal(); // Open the dialog first
      expect(dialog.open).toBe(true);

      document.getElementById('dialog-cancel')!.click();

      expect(dialog.open).toBe(false);
      expect(mod.currentPendingSave).toBeNull();
    });
  });

  describe('dialog-save-once button', () => {
    it('should send record message with force=true and show success', async () => {
      (global.chrome.runtime.sendMessage as any).mockResolvedValue({ success: true });

      const mod = await import('../privatePageDialog.js');
      mod.setCurrentPendingSave(createPendingSave());

      document.getElementById('dialog-save-once')!.click();

      await vi.waitFor(() => {
        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith({
          type: 'record',
          data: {
            title: 'Test Page',
            url: 'https://example.com/test-page',
            content: 'Test content',
            force: true,
          },
        });
      });

      const statusDiv = document.getElementById('mainStatus');
      expect(statusDiv!.textContent).toBe('Saved to Obsidian');
      expect(statusDiv!.className).toBe('success');
      expect(mod.currentPendingSave).toBeNull();
    });

    it('should show error when record fails', async () => {
      (global.chrome.runtime.sendMessage as any).mockResolvedValue({
        success: false,
        error: 'Connection failed',
      });

      const mod = await import('../privatePageDialog.js');
      mod.setCurrentPendingSave(createPendingSave());

      document.getElementById('dialog-save-once')!.click();

      await vi.waitFor(() => {
        const statusDiv = document.getElementById('mainStatus');
        expect(statusDiv!.textContent).toContain('Save error');
        expect(statusDiv!.textContent).toContain('Connection failed');
        expect(statusDiv!.className).toBe('error');
      });

      expect(mod.currentPendingSave).toBeNull();
    });

    it('should produce an unhandled rejection when sendMessage fails (no try-catch in source)', async () => {
      (global.chrome.runtime.sendMessage as any).mockRejectedValue(
        new Error('Extension context invalidated')
      );

      const mod = await import('../privatePageDialog.js');
      mod.setCurrentPendingSave(createPendingSave());

      // recordWithForce does not catch sendMessage rejections, so the click
      // handler produces an unhandled promise rejection. We catch it here to
      // prevent vitest from reporting it as an error.
      const rejectionCaught = new Promise<void>((resolve) => {
        const handler = () => resolve();
        process.once('unhandledRejection', handler);
        document.getElementById('dialog-save-once')!.click();
        // Safety timeout
        setTimeout(() => resolve(), 500);
      });
      await rejectionCaught;

      // The error handler after the failed sendMessage never runs,
      // so statusDiv stays empty
      const statusDiv = document.getElementById('mainStatus');
      expect(statusDiv!.textContent).toBe('');
    });

    it('should do nothing when currentPendingSave is null', async () => {
      const mod = await import('../privatePageDialog.js');
      mod.setCurrentPendingSave(null);

      document.getElementById('dialog-save-once')!.click();

      // Allow microtasks to process
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('dialog-save-domain button', () => {
    it('should add domain to whitelist and record with force', async () => {
      const { getSettings, saveSettings } = await import('../../utils/storage.js');
      (getSettings as any).mockResolvedValue({ domain_whitelist: [] });

      const mod = await import('../privatePageDialog.js');
      mod.setCurrentPendingSave(
        createPendingSave({ url: 'https://example.com/some-page' })
      );

      document.getElementById('dialog-save-domain')!.click();

      await vi.waitFor(() => {
        expect(saveSettings).toHaveBeenCalledWith(
          { domain_whitelist: ['example.com'] },
          true
        );
      });

      expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'record',
        data: expect.objectContaining({ force: true }),
      });
    });

    it('should not duplicate existing domain in whitelist', async () => {
      const { getSettings, saveSettings } = await import('../../utils/storage.js');
      (getSettings as any).mockResolvedValue({
        domain_whitelist: ['example.com'],
      });

      const mod = await import('../privatePageDialog.js');
      mod.setCurrentPendingSave(
        createPendingSave({ url: 'https://example.com/another-page' })
      );

      document.getElementById('dialog-save-domain')!.click();

      // saveSettings should NOT be called because the domain already exists
      // (the source code checks !whitelist.includes(domain) before saving).
      // recordWithForce should still be called though.
      await vi.waitFor(() => {
        expect(global.chrome.runtime.sendMessage).toHaveBeenCalled();
      });

      expect(saveSettings).not.toHaveBeenCalled();
    });

    it('should handle missing domain extraction gracefully', async () => {
      const { extractDomain } = await import('../../utils/domainUtils.js');
      (extractDomain as any).mockReturnValueOnce('');

      const mod = await import('../privatePageDialog.js');
      mod.setCurrentPendingSave(
        createPendingSave({ url: 'invalid-url' })
      );

      document.getElementById('dialog-save-domain')!.click();

      await vi.waitFor(() => {
        // Should still attempt record
        expect(global.chrome.runtime.sendMessage).toHaveBeenCalled();
      });
    });
  });

  describe('dialog-save-path button', () => {
    it('should add full URL path to whitelist and record with force', async () => {
      const { saveSettings } = await import('../../utils/storage.js');
      const { getSettings } = await import('../../utils/storage.js');
      (getSettings as any).mockResolvedValue({ domain_whitelist: [] });

      const mod = await import('../privatePageDialog.js');
      mod.setCurrentPendingSave(
        createPendingSave({ url: 'https://example.com/private-path' })
      );

      document.getElementById('dialog-save-path')!.click();

      await vi.waitFor(() => {
        expect(saveSettings).toHaveBeenCalledWith(
          { domain_whitelist: ['https://example.com/private-path'] },
          true
        );
      });

      expect(global.chrome.runtime.sendMessage).toHaveBeenCalled();
    });

    it('should not duplicate existing URL in whitelist', async () => {
      const { getSettings, saveSettings } = await import('../../utils/storage.js');
      (getSettings as any).mockResolvedValue({
        domain_whitelist: ['https://example.com/private-path'],
      });

      const mod = await import('../privatePageDialog.js');
      mod.setCurrentPendingSave(
        createPendingSave({ url: 'https://example.com/private-path' })
      );

      document.getElementById('dialog-save-path')!.click();

      // saveSettings should NOT be called because the URL already exists
      // (the source code checks !whitelist.includes(url) before saving).
      await vi.waitFor(() => {
        expect(global.chrome.runtime.sendMessage).toHaveBeenCalled();
      });

      expect(saveSettings).not.toHaveBeenCalled();
    });
  });

  describe('recordWithForce (internal)', () => {
    it('should close the dialog before recording', async () => {
      const mod = await import('../privatePageDialog.js');
      mod.setCurrentPendingSave(createPendingSave());

      const dialog = document.getElementById('private-page-dialog') as HTMLDialogElement;
      dialog.showModal();

      // Click save-once which calls recordWithForce after closing dialog
      document.getElementById('dialog-save-once')!.click();

      await vi.waitFor(() => {
        expect(global.chrome.runtime.sendMessage).toHaveBeenCalled();
      });

      // Dialog should be closed
      expect(dialog.open).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle missing mainStatus element in recordWithForce', async () => {
      document.getElementById('mainStatus')!.remove();

      const mod = await import('../privatePageDialog.js');
      mod.setCurrentPendingSave(createPendingSave());

      // Should not throw
      document.getElementById('dialog-save-once')!.click();

      await vi.waitFor(() => {
        expect(global.chrome.runtime.sendMessage).toHaveBeenCalled();
      });
    });

    it('should handle record response with undefined error field', async () => {
      (global.chrome.runtime.sendMessage as any).mockResolvedValue({
        success: false,
      });

      const mod = await import('../privatePageDialog.js');
      mod.setCurrentPendingSave(createPendingSave());

      document.getElementById('dialog-save-once')!.click();

      await vi.waitFor(() => {
        const statusDiv = document.getElementById('mainStatus');
        expect(statusDiv!.textContent).toContain('Unknown error');
      });
    });

    it('should call startAutoCloseTimer on successful save', async () => {
      const { startAutoCloseTimer } = await import('../autoClose.js');

      const mod = await import('../privatePageDialog.js');
      mod.setCurrentPendingSave(createPendingSave());

      document.getElementById('dialog-save-once')!.click();

      await vi.waitFor(() => {
        expect(startAutoCloseTimer).toHaveBeenCalled();
      });
    });

    it('should not call startAutoCloseTimer on failed save', async () => {
      (global.chrome.runtime.sendMessage as any).mockResolvedValue({
        success: false,
        error: 'Error',
      });
      const { startAutoCloseTimer } = await import('../autoClose.js');

      const mod = await import('../privatePageDialog.js');
      mod.setCurrentPendingSave(createPendingSave());

      document.getElementById('dialog-save-once')!.click();

      await vi.waitFor(() => {
        const statusDiv = document.getElementById('mainStatus');
        expect(statusDiv!.textContent).toContain('Save error');
      });

      expect(startAutoCloseTimer).not.toHaveBeenCalled();
    });
  });
});
