// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../errorUtils.js', () => ({
  showError: vi.fn(),
}));

vi.mock('../../../utils/i18n.js', () => ({
  getMessage: vi.fn((key: string) => key),
}));

import { ErrorPresenter } from '../errorPresenter.js';
import { showError } from '../../errorUtils.js';

describe('ErrorPresenter', () => {
  describe('buildPrivatePageErrorMessage', () => {
    it('maps a known reason to a message key', () => {
      const presenter = new ErrorPresenter();
      const message = presenter.buildPrivatePageErrorMessage('cache-control');
      expect(message).toBe('errorPrefix PRIVATE_PAGE_DETECTED (privatePageReason_cachecontrol)');
    });

    it('falls back to "cacheControl" key when reason is undefined', () => {
      const presenter = new ErrorPresenter();
      const message = presenter.buildPrivatePageErrorMessage(undefined);
      expect(message).toBe('errorPrefix PRIVATE_PAGE_DETECTED (privatePageReason_cacheControl)');
    });

    it('strips hyphens from the reason to build the message key', () => {
      const presenter = new ErrorPresenter();
      const message = presenter.buildPrivatePageErrorMessage('no-store');
      expect(message).toBe('errorPrefix PRIVATE_PAGE_DETECTED (privatePageReason_nostore)');
    });
  });

  describe('show', () => {
    it('delegates to showError with statusDiv, error, retryFn', () => {
      const presenter = new ErrorPresenter();
      const statusDiv = document.createElement('div');
      const error = new Error('boom');
      const retryFn = vi.fn();
      presenter.show(statusDiv, error, retryFn);
      expect(showError).toHaveBeenCalledWith(statusDiv, error, retryFn);
    });
  });
});
