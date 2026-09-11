// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockCopyTextToClipboard = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockFormatEntryToMarkdown = vi.hoisted(() => vi.fn().mockReturnValue('# md'));

vi.mock('../clipboard.js', () => ({
  copyTextToClipboard: mockCopyTextToClipboard,
}));
vi.mock('../markdownFormatter.js', () => ({
  formatEntryToMarkdown: mockFormatEntryToMarkdown,
}));

import { createCopyMarkdownButton, COPY_FEEDBACK_RESET_MS } from '../copyMarkdownButton.js';
import type { BrowsingLogEntry } from '../sqlite-types.js';

const entry: BrowsingLogEntry = {
  id: 1,
  url: 'https://example.com',
  title: 'Example',
  summary: 'summary',
  tags: '',
  created_at: 1718880000000,
  is_starred: 0,
};

const labels = {
  initialText: 'Copy',
  successText: '✓',
  failureText: '✗',
  initialAriaLabel: 'Copy Markdown',
  successAriaLabel: 'Copied to clipboard',
  failureAriaLabel: 'Failed to copy',
};

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('createCopyMarkdownButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockCopyTextToClipboard.mockReset().mockResolvedValue(undefined);
    mockFormatEntryToMarkdown.mockReset().mockReturnValue('# md');
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('updates to the success display and aria after markdown conversion and clipboard copy on success', async () => {
    const btn = createCopyMarkdownButton(entry, { className: 'c', labels });
    expect(btn.textContent).toBe('Copy');
    expect(btn.getAttribute('aria-label')).toBe('Copy Markdown');
    expect(btn.className).toBe('c');

    btn.click();
    await flush();

    expect(mockFormatEntryToMarkdown).toHaveBeenCalledWith(entry);
    expect(mockCopyTextToClipboard).toHaveBeenCalledWith('# md');
    expect(btn.textContent).toBe('✓');
    expect(btn.getAttribute('aria-label')).toBe('Copied to clipboard');
    expect(btn.disabled).toBe(true);
  });

  it('restores the original display and aria after the default 2000ms', async () => {
    expect(COPY_FEEDBACK_RESET_MS).toBe(2000);
    const btn = createCopyMarkdownButton(entry, { labels });
    btn.click();
    await flush();
    expect(btn.textContent).toBe('✓');

    await vi.advanceTimersByTimeAsync(2000);
    expect(btn.textContent).toBe('Copy');
    expect(btn.getAttribute('aria-label')).toBe('Copy Markdown');
    expect(btn.disabled).toBe(false);
  });

  it('switches to the failure display without leaking exceptions on failure and restores after the timer', async () => {
    mockCopyTextToClipboard.mockRejectedValueOnce(new Error('clipboard fail'));
    const btn = createCopyMarkdownButton(entry, { labels });
    btn.click();
    await flush();

    expect(btn.textContent).toBe('✗');
    expect(btn.getAttribute('aria-label')).toBe('Failed to copy');
    expect(btn.disabled).toBe(true);

    await vi.advanceTimersByTimeAsync(2000);
    expect(btn.textContent).toBe('Copy');
    expect(btn.getAttribute('aria-label')).toBe('Copy Markdown');
    expect(btn.disabled).toBe(false);
  });

  it('leaves aria attributes untouched when aria labels are omitted (popup compatibility)', async () => {
    const btn = createCopyMarkdownButton(entry, {
      labels: { initialText: 'Copy Markdown', successText: 'Copied!', failureText: 'Copy failed' },
    });
    expect(btn.hasAttribute('aria-label')).toBe(false);
    btn.click();
    await flush();
    expect(btn.textContent).toBe('Copied!');
    expect(btn.hasAttribute('aria-label')).toBe(false);
  });

  it('overrides the restore timing when timeoutMs is specified', async () => {
    const btn = createCopyMarkdownButton(entry, { labels, timeoutMs: 500 });
    btn.click();
    await flush();
    expect(btn.textContent).toBe('✓');
    await vi.advanceTimersByTimeAsync(500);
    expect(btn.textContent).toBe('Copy');
    expect(btn.disabled).toBe(false);
  });
});
