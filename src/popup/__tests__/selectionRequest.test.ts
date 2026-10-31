// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/i18n.js', async () => {
  const { mockGetMessage: i18nMock } = await import('../../../testDir/i18nMock.js');
  const getMessage = vi.fn((key: string) => key);
  return i18nMock(getMessage);
});

import { requestSelectionFromTab } from '../contentFetchGateway.js';

/**
 * Selection-capture ask (PBI 2026-10-31-03). Mirrors the GET_CONTENT null
 * contract: a passive ask that resolves null when the content script does not
 * answer — callers fall back to the page record, never prompt for
 * permissions.
 */
describe('requestSelectionFromTab', () => {
  beforeEach(() => {
    chrome.tabs.sendMessage = vi.fn().mockResolvedValue(null);
  });

  it('sends GET_SELECTION to the tab and returns the response', async () => {
    chrome.tabs.sendMessage = vi.fn().mockResolvedValue({ selection: 'selected paragraph' });

    const result = await requestSelectionFromTab(1);

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, { type: 'GET_SELECTION' });
    expect(result).toEqual({ selection: 'selected paragraph' });
  });

  it('resolves null when the tab answers null (no selection)', async () => {
    await expect(requestSelectionFromTab(1)).resolves.toBeNull();
  });

  it('resolves null when the send rejects (content script not injected)', async () => {
    chrome.tabs.sendMessage = vi.fn().mockRejectedValue(new Error('Could not establish connection'));

    await expect(requestSelectionFromTab(1)).resolves.toBeNull();
  });

  it('resolves null when the tab does not answer within the timeout', async () => {
    // The ask is raced against the gateway timeout; the loser is a real
    // timer, so the fake-clock helpers cannot drive it — inject a shorter
    // timeout and let the race settle on it.
    chrome.tabs.sendMessage = vi.fn().mockReturnValue(new Promise(() => {}));

    await expect(requestSelectionFromTab(1, { timeoutMs: 10 })).resolves.toBeNull();
  });
});
