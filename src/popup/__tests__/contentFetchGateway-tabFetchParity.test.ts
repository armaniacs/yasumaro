// @vitest-environment wasm-quickjs-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTimerClock } from '../../../testDir/waitPolicy.js';

vi.mock('../../utils/i18n.js', async () => {
  const { mockGetMessage: i18nMock } = await import('../../../testDir/i18nMock.js');
  const getMessage = vi.fn((key: string) => key);
  return i18nMock(getMessage);
});

import {
  ContentFetchGateway,
  askTab,
  requestContentFromTab,
  requestSelectionFromTab,
} from '../contentFetchGateway.js';

/**
 * Parity pin for the tab-fetch unify refactor (PBI 2026-11-20-01).
 *
 * Records the observable behavior of `requestContentFromTab` and
 * `requestSelectionFromTab` BEFORE they are delegated to the shared `askTab`
 * helper: success passthrough, null answer, transport throw, and timeout all
 * resolve as they do today. Fake clock + injected transports only; no
 * real-time waits.
 */
describe('contentFetchGateway tab-fetch parity', () => {
  describe('requestContentFromTab', () => {
    it('sends GET_CONTENT to the tab and returns the response verbatim', async () => {
      const sendMessage = vi.fn().mockResolvedValue({ content: 'page body' });
      chrome.tabs.sendMessage = sendMessage;

      const result = await requestContentFromTab(1);

      expect(sendMessage).toHaveBeenCalledWith(1, { type: 'GET_CONTENT' });
      expect(result).toEqual({ content: 'page body' });
    });

    it('resolves null when the tab answers null', async () => {
      chrome.tabs.sendMessage = vi.fn().mockResolvedValue(null);

      await expect(requestContentFromTab(1)).resolves.toBeNull();
    });

    it('resolves null when the send rejects (content script not injected)', async () => {
      const transport = vi.fn().mockRejectedValue(new Error('Could not establish connection'));

      await expect(requestContentFromTab(1, { transport })).resolves.toBeNull();
    });

    it('resolves null when the tab does not answer within the timeout', async () => {
      const transport = vi.fn().mockReturnValue(new Promise(() => undefined));

      const pending = requestContentFromTab(1, { timeoutMs: 100, transport });
      await vi.advanceTimersByTimeAsync(100);

      await expect(pending).resolves.toBeNull();
    });

    it('still resolves null when the transport rejects after the timeout already won', async () => {
      let rejectSend!: (reason: unknown) => void;
      const transport = vi.fn().mockReturnValue(
        new Promise<never>((_, reject) => {
          rejectSend = reject;
        }),
      );

      const pending = requestContentFromTab(1, { timeoutMs: 50, transport });
      await vi.advanceTimersByTimeAsync(50);
      await expect(pending).resolves.toBeNull();
      rejectSend(new Error('late rejection'));
      await Promise.resolve();
    });
  });

  describe('requestSelectionFromTab', () => {
    it('sends GET_SELECTION to the tab and returns the response verbatim', async () => {
      const sendMessage = vi.fn().mockResolvedValue({ selection: 'selected paragraph' });
      chrome.tabs.sendMessage = sendMessage;

      const result = await requestSelectionFromTab(1);

      expect(sendMessage).toHaveBeenCalledWith(1, { type: 'GET_SELECTION' });
      expect(result).toEqual({ selection: 'selected paragraph' });
    });

    it('resolves null when the tab answers null (no selection)', async () => {
      chrome.tabs.sendMessage = vi.fn().mockResolvedValue(null);

      await expect(requestSelectionFromTab(1)).resolves.toBeNull();
    });

    it('resolves null when the send rejects (content script not injected)', async () => {
      const transport = vi.fn().mockRejectedValue(new Error('Could not establish connection'));

      await expect(requestSelectionFromTab(1, { transport })).resolves.toBeNull();
    });

    it('resolves null when the tab does not answer within the timeout', async () => {
      const transport = vi.fn().mockReturnValue(new Promise(() => undefined));

      const pending = requestSelectionFromTab(1, { timeoutMs: 100, transport });
      await vi.advanceTimersByTimeAsync(100);

      await expect(pending).resolves.toBeNull();
    });
  });

  describe('askTab timer ownership', () => {
    it('leaves no pending timer behind after a fast answer (clearTimeout path)', async () => {
      const transport = vi.fn().mockResolvedValue({ content: 'fast' });

      const result = await askTab<{ content: string }>(1, 'GET_CONTENT', { transport });

      expect(result).toEqual({ content: 'fast' });
      expect(transport).toHaveBeenCalledWith(1, { type: 'GET_CONTENT' });
      expect(vi.getTimerCount()).toBe(0);
    });

    it('leaves no pending timer behind after a timeout either', async () => {
      const transport = vi.fn().mockReturnValue(new Promise(() => undefined));

      const pending = askTab(1, 'GET_CONTENT', { timeoutMs: 100, transport });
      await vi.advanceTimersByTimeAsync(100);

      await expect(pending).resolves.toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('permission ladder entry', () => {
    it('fetch returns the tab answer without consulting the permission ladder', async () => {
      chrome.tabs.sendMessage = vi.fn().mockResolvedValue({ content: 'tab content' });
      chrome.permissions.request = vi.fn();
      const tab = { id: 1, url: 'https://example.com/page' } as chrome.tabs.Tab;

      const result = await new ContentFetchGateway().fetch(tab, false);

      expect(result).toEqual({ content: 'tab content' });
      expect(chrome.permissions.request).not.toHaveBeenCalled();
    });
  });

  beforeEach(() => {
    useTimerClock();
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
