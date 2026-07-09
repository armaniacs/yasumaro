// @vitest-environment jsdom
/**
 * clipboard.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('copyTextToClipboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('copies text using navigator.clipboard when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    const { copyTextToClipboard } = await import('../clipboard.js');
    await copyTextToClipboard('hello');
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('throws when navigator.clipboard is not available', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    const { copyTextToClipboard } = await import('../clipboard.js');
    await expect(copyTextToClipboard('hello')).rejects.toThrow('Clipboard API not available');
  });
});
