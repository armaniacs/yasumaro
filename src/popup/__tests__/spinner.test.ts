// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { showSpinner, hideSpinner } from '../spinner.js';

vi.mock('../../utils/i18n.js', () => ({
  getMessage: (key: string) => `i18n_${key}`,
}));

describe('spinner', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="loadingSpinner" style="display:none"><span class="spinner-text"></span></div>';
  });

  it('showSpinner shows element with custom text', () => {
    showSpinner('Loading...');
    const spinner = document.getElementById('loadingSpinner')!;
    expect(spinner.style.display).toBe('flex');
    expect(spinner.querySelector('.spinner-text')!.textContent).toBe('Loading...');
  });

  it('showSpinner uses i18n default when no text provided', () => {
    showSpinner();
    const spinner = document.getElementById('loadingSpinner')!;
    expect(spinner.querySelector('.spinner-text')!.textContent).toBe('i18n_processing');
  });

  it('hideSpinner hides element', () => {
    showSpinner('test');
    hideSpinner();
    const spinner = document.getElementById('loadingSpinner')!;
    expect(spinner.style.display).toBe('none');
  });

  it('showSpinner warns when element missing', () => {
    document.body.innerHTML = '';
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    showSpinner();
    expect(consoleSpy).toHaveBeenCalledWith('loadingSpinner element not found');
    consoleSpy.mockRestore();
  });

  it('showSpinner handles missing spinner-text element gracefully', () => {
    document.body.innerHTML = '<div id="loadingSpinner" style="display:none"></div>';
    showSpinner('Custom text');
    const spinner = document.getElementById('loadingSpinner')!;
    expect(spinner.style.display).toBe('flex');
    expect(spinner.getAttribute('role')).toBe('status');
    expect(spinner.getAttribute('aria-live')).toBe('polite');
  });

  it('hideSpinner warns when element missing', () => {
    document.body.innerHTML = '';
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    hideSpinner();
    expect(consoleSpy).toHaveBeenCalledWith('loadingSpinner element not found');
    consoleSpy.mockRestore();
  });

  it('showSpinner sets aria attributes', () => {
    showSpinner('test');
    const spinner = document.getElementById('loadingSpinner')!;
    expect(spinner.getAttribute('role')).toBe('status');
    expect(spinner.getAttribute('aria-live')).toBe('polite');
  });
});
