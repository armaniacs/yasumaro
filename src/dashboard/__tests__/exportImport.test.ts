// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../popup/i18n.js', () => ({
  getMessage: (key: string) => `i18n_${key}`,
}));

vi.mock('../../popup/utils/focusTrap.js', () => ({
  focusTrapManager: {
    trap: vi.fn().mockReturnValue('trap-id'),
    release: vi.fn(),
  },
}));

describe('closeImportModal', async () => {
  // DOM must be set up BEFORE importing the module (module-level getElementById calls)
  document.body.innerHTML = `
    <div id="importConfirmModal" class="show" style="display:flex" aria-hidden="false"></div>
    <div id="importPreview"></div>
  `;
  const { closeImportModal } = await import('../exportImport.js');

  it('hides the import modal', () => {
    closeImportModal();
    const modal = document.getElementById('importConfirmModal')!;
    expect(modal.classList.contains('show')).toBe(false);
    expect(modal.style.display).toBe('none');
    expect(modal.classList.contains('hidden')).toBe(true);
    expect(modal.getAttribute('aria-hidden')).toBe('true');
  });

  it.skip('clears import preview', () => {
    const preview = document.getElementById('importPreview')!;
    preview.textContent = 'test data';
    closeImportModal();
    expect(preview.textContent).toBe('');
  });

  it('does not throw when modal is missing', async () => {
    document.body.innerHTML = `
      <div id="importConfirmModal"></div>
      <div id="importPreview"></div>
    `;
    expect(() => closeImportModal()).not.toThrow();
  });
});
