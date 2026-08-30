// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/i18n.js', () => ({
  getMessage: vi.fn((key: string) => key),
}));

import { TabContentFetcher } from '../recordCurrentPage/tabContentFetcher.js';
import { SpinnerManager } from '../recordCurrentPage/spinnerManager.js';

describe('TabContentFetcher permission ladder', () => {
  let mockSpinner: SpinnerManager;

  beforeEach(() => {
    mockSpinner = { show: vi.fn(), hide: vi.fn() } as unknown as SpinnerManager;
    chrome.tabs.sendMessage = vi.fn().mockRejectedValue(new Error('no content script'));
    chrome.runtime.lastError = null;
    chrome.permissions.contains = vi.fn();
    chrome.permissions.request = vi.fn();
    chrome.scripting.executeScript = vi.fn();
    chrome.storage.local.get = vi.fn();
  });

  it('Level1 success: per-origin permission granted → executeScript called, no all_urls request', async () => {
    chrome.permissions.contains = vi.fn().mockResolvedValue(false);
    chrome.permissions.request = vi.fn().mockImplementation((req: { origins: string[] }) => {
      if (req.origins[0] === '*://example.com/*') return Promise.resolve(true);
      return Promise.resolve(false);
    });
    chrome.storage.local.get = vi.fn().mockResolvedValue({ allow_all_urls_opt_in: false });
    chrome.scripting.executeScript = vi.fn().mockResolvedValue([{ result: 'per-origin content' }]);

    const fetcher = new TabContentFetcher(mockSpinner);
    const result = await fetcher.fetch({ id: 1, url: 'https://example.com/page' } as chrome.tabs.Tab, false);
    expect(result).toEqual({ content: 'per-origin content' });
    expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: ['*://example.com/*'] });
    // all_urls should not be requested
    expect(chrome.permissions.request).not.toHaveBeenCalledWith({ origins: ['<all_urls>'] });
  });

  it('Level1 already permitted (isHostPermitted true) → no request, immediate fallback success', async () => {
    chrome.permissions.contains = vi.fn().mockImplementation((req: { origins: string[] }) => {
      if (req.origins[0] === '*://example.com/*') return Promise.resolve(true);
      if (req.origins[0] === '<all_urls>') return Promise.resolve(false);
      return Promise.resolve(false);
    });
    chrome.permissions.request = vi.fn().mockResolvedValue(false);
    chrome.storage.local.get = vi.fn().mockResolvedValue({});
    chrome.scripting.executeScript = vi.fn().mockResolvedValue([{ result: 'already permitted' }]);

    const fetcher = new TabContentFetcher(mockSpinner);
    const result = await fetcher.fetch({ id: 1, url: 'https://example.com/page' } as chrome.tabs.Tab, false);
    expect(result).toEqual({ content: 'already permitted' });
  });

  it('Level2 success: per-origin denied but allowAllUrlsOptIn true → requests <all_urls> and succeeds', async () => {
    chrome.permissions.contains = vi.fn().mockResolvedValue(false);
    chrome.permissions.request = vi.fn().mockImplementation((req: { origins: string[] }) => {
      if (req.origins[0] === '*://example.com/*') return Promise.resolve(false);
      if (req.origins[0] === '<all_urls>') return Promise.resolve(true);
      return Promise.resolve(false);
    });
    // Mock storage to return opt-in true (new key)
    chrome.storage.local.get = vi.fn().mockImplementation((key: string | string[]) => {
      const k = typeof key === 'string' ? key : Array.isArray(key) ? key[0] : '';
      if (k === 'allow_all_urls_opt_in') return Promise.resolve({ allow_all_urls_opt_in: true });
      if (k === 'allowAllUrlsOptIn') return Promise.resolve({});
      return Promise.resolve({});
    });
    chrome.scripting.executeScript = vi.fn().mockResolvedValue([{ result: 'all_urls content' }]);

    const fetcher = new TabContentFetcher(mockSpinner);
    const result = await fetcher.fetch({ id: 1, url: 'https://example.com/page' } as chrome.tabs.Tab, false);
    expect(result).toEqual({ content: 'all_urls content' });
    expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: ['<all_urls>'] });
  });

  it('rejects when per-origin denied and opt-in false (no all_urls request)', async () => {
    chrome.permissions.contains = vi.fn().mockResolvedValue(false);
    chrome.permissions.request = vi.fn().mockResolvedValue(false);
    chrome.storage.local.get = vi.fn().mockResolvedValue({ allow_all_urls_opt_in: false, allowAllUrlsOptIn: false });
    chrome.scripting.executeScript = vi.fn().mockResolvedValue([{ result: 'should not reach' }]);

    const fetcher = new TabContentFetcher(mockSpinner);
    await expect(fetcher.fetch({ id: 1, url: 'https://example.com/page' } as chrome.tabs.Tab, false)).rejects.toThrow('errorContentScriptNotAvailable');
    expect(chrome.permissions.request).not.toHaveBeenCalledWith({ origins: ['<all_urls>'] });
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('rejects when both per-origin and all_urls denied (opt-in true but user rejects)', async () => {
    chrome.permissions.contains = vi.fn().mockResolvedValue(false);
    chrome.permissions.request = vi.fn().mockResolvedValue(false);
    chrome.storage.local.get = vi.fn().mockResolvedValue({ allow_all_urls_opt_in: true });
    const fetcher = new TabContentFetcher(mockSpinner);
    await expect(fetcher.fetch({ id: 1, url: 'https://example.com/page' } as chrome.tabs.Tab, false)).rejects.toThrow('errorContentScriptNotAvailable');
  });
});
