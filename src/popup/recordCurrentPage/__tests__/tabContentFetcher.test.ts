// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../utils/i18n.js', () => ({
  getMessage: vi.fn((key: string) => key),
}));

import { TabContentFetcher } from '../tabContentFetcher.js';
import { SpinnerManager } from '../spinnerManager.js';

describe('TabContentFetcher', () => {
  let mockSpinner: SpinnerManager;

  beforeEach(() => {
    mockSpinner = { show: vi.fn(), hide: vi.fn() } as unknown as SpinnerManager;
    chrome.tabs.sendMessage = vi.fn();
    chrome.runtime.lastError = null;
    chrome.permissions.contains = vi.fn().mockResolvedValue(true);
    chrome.permissions.request = vi.fn().mockResolvedValue(true);
    chrome.scripting.executeScript = vi.fn();
  });

  it('throws when tab has no id', async () => {
    const fetcher = new TabContentFetcher(mockSpinner);
    await expect(fetcher.fetch({} as chrome.tabs.Tab, false)).rejects.toThrow('No active tab found');
  });

  it('returns content from GET_CONTENT when sendMessage succeeds', async () => {
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ content: 'hello' });
    const fetcher = new TabContentFetcher(mockSpinner);
    const result = await fetcher.fetch({ id: 1 } as chrome.tabs.Tab, false);
    expect(result).toEqual({ content: 'hello' });
    expect(mockSpinner.show).toHaveBeenCalledWith('fetchingContent');
  });

  it('falls back to scripting.executeScript when sendMessage rejects and permission is granted', async () => {
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no content script'));
    (chrome.scripting.executeScript as ReturnType<typeof vi.fn>).mockResolvedValue([{ result: 'fallback text' }]);
    const fetcher = new TabContentFetcher(mockSpinner);
    const result = await fetcher.fetch({ id: 1, url: 'https://example.com/page' } as chrome.tabs.Tab, false);
    expect(result).toEqual({ content: 'fallback text' });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 1 },
      func: expect.any(Function),
    });
  });

  it('requests per-origin permission when not already granted', async () => {
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
    (chrome.permissions.contains as ReturnType<typeof vi.fn>).mockImplementation((req: { origins: string[] }) => Promise.resolve(req.origins[0] === '<all_urls>'));
    (chrome.permissions.request as ReturnType<typeof vi.fn>).mockImplementation((req: { origins: string[] }) => Promise.resolve(req.origins[0] === '*://example.com/*'));
    (chrome.scripting.executeScript as ReturnType<typeof vi.fn>).mockResolvedValue([{ result: 'ok' }]);
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const fetcher = new TabContentFetcher(mockSpinner);
    await fetcher.fetch({ id: 1, url: 'https://example.com/page' } as chrome.tabs.Tab, false);
    expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: ['*://example.com/*'] });
  });

  it('throws errorContentScriptNotAvailable when permission is denied', async () => {
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
    (chrome.permissions.contains as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (chrome.permissions.request as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const fetcher = new TabContentFetcher(mockSpinner);
    await expect(fetcher.fetch({ id: 1, url: 'https://example.com/page' } as chrome.tabs.Tab, false)).rejects.toThrow('errorContentScriptNotAvailable');
  });

  it('returns empty content when force=true and scripting.executeScript also fails', async () => {
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
    (chrome.permissions.contains as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (chrome.scripting.executeScript as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('script fail'));
    const fetcher = new TabContentFetcher(mockSpinner);
    const result = await fetcher.fetch({ id: 1, url: 'https://example.com/page' } as chrome.tabs.Tab, true);
    expect(result).toEqual({ content: '' });
  });

  it('throws errorContentScriptNotAvailable when force=false and scripting.executeScript fails', async () => {
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
    (chrome.permissions.contains as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (chrome.scripting.executeScript as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('script fail'));
    const fetcher = new TabContentFetcher(mockSpinner);
    await expect(fetcher.fetch({ id: 1, url: 'https://example.com/page' } as chrome.tabs.Tab, false)).rejects.toThrow('errorContentScriptNotAvailable');
  });

  it('uses default SpinnerManager when none is injected', async () => {
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ content: 'x' });
    const fetcher = new TabContentFetcher();
    const result = await fetcher.fetch({ id: 1 } as chrome.tabs.Tab, false);
    expect(result).toEqual({ content: 'x' });
  });
});
