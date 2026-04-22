// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createPaginationControls, showRecordError, checkServiceWorkerAlive } from '../historyUtils.js';

vi.mock('../popup/i18n.js', () => ({
  getMessage: (key: string) => key,
}));

describe('createPaginationControls', () => {
  it('creates pagination with prev disabled on first page', () => {
    const nav = createPaginationControls(0, 5, () => {});
    expect(nav.className).toBe('pending-pagination');
    const buttons = nav.querySelectorAll('button');
    expect(buttons[0].disabled).toBe(true);
    expect(buttons[1].disabled).toBe(false);
  });

  it('creates pagination with next disabled on last page', () => {
    const nav = createPaginationControls(4, 5, () => {});
    const buttons = nav.querySelectorAll('button');
    expect(buttons[0].disabled).toBe(false);
    expect(buttons[1].disabled).toBe(true);
  });

  it('calls onPageChange when prev clicked', () => {
    const mockFn = vi.fn();
    const nav = createPaginationControls(2, 5, mockFn);
    const prevBtn = nav.querySelectorAll('button')[0];
    prevBtn.click();
    expect(mockFn).toHaveBeenCalledWith(1);
  });

  it('calls onPageChange when next clicked', () => {
    const mockFn = vi.fn();
    const nav = createPaginationControls(2, 5, mockFn);
    const nextBtn = nav.querySelectorAll('button')[1];
    nextBtn.click();
    expect(mockFn).toHaveBeenCalledWith(3);
  });
});

describe('showRecordError', () => {
  it('shows error message from Error', () => {
    const info = document.createElement('div');
    showRecordError(info, new Error('test error'));
    const el = info.querySelector('.record-error-message');
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe('test error');
  });

  it('shows generic error message', () => {
    const info = document.createElement('div');
    showRecordError(info, 'unknown');
    const el = info.querySelector('.record-error-message');
    expect(el).not.toBeNull();
  });
});

describe('checkServiceWorkerAlive', () => {
  it('returns true when service worker responds', async () => {
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: true });
    const result = await checkServiceWorkerAlive();
    expect(result).toBe(true);
  });

  it('returns false when service worker throws', async () => {
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('no response'));
    const result = await checkServiceWorkerAlive();
    expect(result).toBe(false);
  });
  it('returns false when response is not success', async () => {
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: false });
    const result = await checkServiceWorkerAlive();
    expect(result).toBe(false);
  });
});
