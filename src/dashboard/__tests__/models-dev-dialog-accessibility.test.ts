/**
 * models-dev-dialog-accessibility.test.ts
 * Accessibility tests for the Models.dev dialog.
 *
 * PBI 2026-09-11-01 (round 7): the static HTML twin was deleted — the TS
 * class builds the dialog via createDialog(). This test now instantiates the
 * real dialog and inspects the SHIPPED DOM (previously it string-matched a
 * drifted static copy whose a11y attributes the implementation did not fully
 * meet — the parity gaps were closed in the same change).
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'models-dev-dialog.ts'),
  'utf-8'
);

async function createMountedDialog() {
  const { ModelsDevDialog } = await import('../models-dev-dialog.js');
  const dialog = new ModelsDevDialog({ onCancel: vi.fn(), onSave: vi.fn() } as never);
  await dialog.show();
  return dialog;
}

describe('Models Dev Dialog - Accessibility (ARIA Attributes)', () => {
  beforeEach(() => {
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  async function mounted(): Promise<HTMLElement> {
    const dialog = await createMountedDialog();
    return (dialog as unknown as { dialog: HTMLElement }).dialog;
  }

  describe('Error message area', () => {
    it('has aria-live="polite" on the shipped dialog-error element', async () => {
      const el = await mounted();
      const error = el.querySelector('#dialog-error');
      expect(error).not.toBeNull();
      expect(error!.getAttribute('aria-live')).toBe('polite');
      expect(error!.className).toContain('error-message');
    });
  });

  describe('Loading state', () => {
    it('has aria-live="polite" and aria-busy on the shipped dialog-loading element', async () => {
      const el = await mounted();
      const loading = el.querySelector('#dialog-loading');
      expect(loading).not.toBeNull();
      expect(loading!.getAttribute('aria-live')).toBe('polite');
      expect(loading!.getAttribute('aria-busy')).toBe('true');
      expect(loading!.className).toContain('loading-state');
    });
  });

  describe('API Key input', () => {
    it('has aria-required="true" on the API key input', async () => {
      const el = await mounted();
      const input = el.querySelector('#api-key-input');
      expect(input).not.toBeNull();
      expect(input!.getAttribute('aria-required')).toBe('true');
      expect(input!.getAttribute('type')).toBe('password');
    });

    it('has an associated label', async () => {
      const el = await mounted();
      expect(el.querySelector('label[for="api-key-input"]')).not.toBeNull();
      expect(el.querySelector('#api-key-input')).not.toBeNull();
    });
  });

  describe('Modal dialog accessibility', () => {
    it('has role="dialog" and aria-modal="true"', async () => {
      const el = await mounted();
      expect(el.getAttribute('role')).toBe('dialog');
      expect(el.getAttribute('aria-modal')).toBe('true');
    });

    it('has aria-labelledby pointing to the title', async () => {
      const el = await mounted();
      expect(el.getAttribute('aria-labelledby')).toBe('dialog-title');
      expect(el.querySelector('#dialog-title')).not.toBeNull();
    });
  });

  describe('Tab navigation (ARIA tab pattern)', () => {
    it('has a tablist with aria-label and tab buttons', async () => {
      const el = await mounted();
      expect(el.querySelector('[role="tablist"]')!.getAttribute('aria-label')).toBe('Provider categories');
      expect(el.querySelectorAll('[role="tab"]').length).toBeGreaterThan(0);
      expect(el.querySelector('[role="tabpanel"]')).not.toBeNull();
      expect(el.querySelector('#provider-list')!.getAttribute('aria-labelledby')).toBe('tab-all');
    });
  });

  describe('Button accessibility', () => {
    it('has type="button" on all buttons and a labelled close button', async () => {
      const el = await mounted();
      const buttons = el.querySelectorAll('button');
      expect(buttons.length).toBeGreaterThan(0);
      for (const b of buttons) {
        expect(b.getAttribute('type')).toBe('button');
      }
      expect(el.querySelector('#dialog-close')!.getAttribute('aria-label')).toContain('Close');
    });

    it('keeps data-i18n on the footer buttons (cancel/save)', async () => {
      const el = await mounted();
      expect(el.querySelector('#dialog-cancel')!.getAttribute('data-i18n')).toBe('cancel');
      expect(el.querySelector('#dialog-save')!.getAttribute('data-i18n')).toBe('save');
    });
  });

  describe('Input accessibility', () => {
    it('has placeholders on search and model inputs', async () => {
      const el = await mounted();
      expect(el.querySelector('#provider-search')!.getAttribute('placeholder')).toBeTruthy();
      expect(el.querySelector('#model-input')!.getAttribute('placeholder')).toBeTruthy();
    });
  });

  describe('Label associations', () => {
    it('associates model and API key labels', async () => {
      const el = await mounted();
      expect(el.querySelector('label[for="model-input"]')).not.toBeNull();
      expect(el.querySelector('label[for="api-key-input"]')).not.toBeNull();
    });
  });

  describe('Esc handling (PBI 2026-09-11-01)', () => {
    it('routes Escape through the focusTrap closeCallback — hide() is idempotent', async () => {
      const dialog = await createMountedDialog();
      const el = (dialog as unknown as { dialog: HTMLElement }).dialog;
      const onCancel = vi.fn();
      (dialog as unknown as { options: { onCancel: unknown } }).options.onCancel = onCancel;
      // Press Escape twice: the focusTrap closeCallback runs hide(); the
      // second invocation (from any stray path) must be a no-op.
      dialog.hide();
      dialog.hide();
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(el.classList.contains('hidden')).toBe(true);
    });

    it('keeps the source free of a document-level Esc listener', () => {
      // The deleted duplicate: document.addEventListener('keydown', Escape → hide()).
      expect(source).not.toMatch(/document\.addEventListener\(\s*['"]keydown['"]/);
    });
  });
});
