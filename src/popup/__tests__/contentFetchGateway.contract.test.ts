// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/i18n.js', async () => {
  const { mockGetMessage: i18nMock } = await import('../../../testDir/i18nMock.js');
  const getMessage = vi.fn((key: string) => key);
  return i18nMock(getMessage);
});

vi.mock('../spinner.js', () => ({
  showSpinner: vi.fn(),
  hideSpinner: vi.fn(),
}));

import {
  ContentFetchGateway,
  requestContentFromTab,
} from '../contentFetchGateway.js';

/**
 * Gateway null contract (PBI 2026-10-05-32): a null tab answer is settled
 * inside the gateway — `fetch` resolves a `ContentResponse` or throws, and
 * never surfaces null to RecordSession. Moved here from the RecordSession
 * null-assumption tests (`main.test.ts`, `recordOrchestrator.test.ts`).
 */
describe('ContentFetchGateway null contract', () => {
  const tab = { id: 1, url: 'https://example.com/page' } as chrome.tabs.Tab;

  beforeEach(() => {
    chrome.tabs.sendMessage = vi.fn().mockResolvedValue(null);
    chrome.permissions.contains = vi.fn();
    chrome.permissions.request = vi.fn();
    chrome.scripting.executeScript = vi.fn();
    chrome.storage.local.get = vi.fn().mockResolvedValue({});
  });

  it('requestContentFromTab resolves null when the tab answers null', async () => {
    await expect(requestContentFromTab(1)).resolves.toBeNull();
  });

  it('fetch recovers via the ladder when the tab answers null (never null)', async () => {
    chrome.permissions.contains = vi.fn().mockImplementation((req: { origins: string[] }) => {
      if (req.origins[0] === '*://example.com/*') return Promise.resolve(true);
      return Promise.resolve(false);
    });
    chrome.permissions.request = vi.fn().mockResolvedValue(false);
    chrome.scripting.executeScript = vi.fn().mockResolvedValue([{ result: 'ladder content' }]);

    const result = await new ContentFetchGateway().fetch(tab, false);
    expect(result).not.toBeNull();
    expect(result).toEqual({ content: 'ladder content' });
  });

  it('fetch rejects (never null) when the tab answers null and no permission is granted', async () => {
    chrome.permissions.contains = vi.fn().mockResolvedValue(false);
    chrome.permissions.request = vi.fn().mockResolvedValue(false);
    chrome.storage.local.get = vi.fn().mockResolvedValue({ allow_all_urls_opt_in: false, allowAllUrlsOptIn: false });

    await expect(new ContentFetchGateway().fetch(tab, false)).rejects.toThrow(
      'errorContentScriptNotAvailable',
    );
  });

  it('fetch with force degrades to empty content when the tab answers null and extraction fails', async () => {
    chrome.permissions.contains = vi.fn().mockImplementation((req: { origins: string[] }) => {
      if (req.origins[0] === '*://example.com/*') return Promise.resolve(true);
      return Promise.resolve(false);
    });
    chrome.permissions.request = vi.fn().mockResolvedValue(false);
    chrome.scripting.executeScript = vi.fn().mockRejectedValue(new Error('Script execution failed'));

    const result = await new ContentFetchGateway().fetch(tab, true);
    expect(result).toEqual({ content: '' });
  });
});
