// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../spinner.js', () => ({
  showSpinner: vi.fn(),
  hideSpinner: vi.fn(),
}));

import { SpinnerManager } from '../spinnerManager.js';
import { showSpinner, hideSpinner } from '../../spinner.js';

describe('SpinnerManager', () => {
  it('delegates show() to showSpinner with message', () => {
    const manager = new SpinnerManager();
    manager.show('loading...');
    expect(showSpinner).toHaveBeenCalledWith('loading...');
  });

  it('delegates hide() to hideSpinner', () => {
    const manager = new SpinnerManager();
    manager.hide();
    expect(hideSpinner).toHaveBeenCalled();
  });
});
