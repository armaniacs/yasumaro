// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { showSpinner, hideSpinner } from '../spinner.js';
import { logWarn } from '../../utils/logger/api.js';

vi.mock('../../utils/i18n.js', async () => {
  const { mockGetMessage: i18nMock } = await import('../../../testDir/i18nMock.js');
  const getMessage = (key: string) => `i18n_${key}`;
  return i18nMock(getMessage);
});

vi.mock('../../utils/logger/api.js', () => ({ logWarn: vi.fn(() => Promise.resolve()) }));

describe('spinner', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="loadingSpinner" style="display:none"><span class="spinner-text"></span></div>';
    vi.clearAllMocks();
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
    showSpinner();
    expect(vi.mocked(logWarn)).toHaveBeenCalledWith('loadingSpinner element not found', {}, undefined, 'spinner');
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
    hideSpinner();
    expect(vi.mocked(logWarn)).toHaveBeenCalledWith('loadingSpinner element not found', {}, undefined, 'spinner');
  });

  it('showSpinner sets aria attributes', () => {
    showSpinner('test');
    const spinner = document.getElementById('loadingSpinner')!;
    expect(spinner.getAttribute('role')).toBe('status');
    expect(spinner.getAttribute('aria-live')).toBe('polite');
  });
});
