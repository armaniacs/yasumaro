/**
 * senderGuard.test.ts
 * Tests for rejectContentScriptSender — the sender-context guard applied to
 * privileged message handlers (VULN-004/009/018/019/020).
 *
 * Content scripts run inside a tab on a web page and satisfy the registry's
 * `sender.id === chrome.runtime.id` check, so they must be explicitly rejected
 * for handlers that are meant for extension pages / offscreen only.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { rejectContentScriptSender } from '../messageHandlers.js';

function makeSendResponse() {
  return vi.fn();
}

describe('rejectContentScriptSender', () => {
  const runtimeId = 'test-extension-id';

  beforeAll(() => {
    (globalThis as Record<string, unknown>).chrome = {
      runtime: { id: runtimeId },
    };
  });

  afterAll(() => {
    delete (globalThis as Record<string, unknown>).chrome;
  });

  it('rejects a content-script sender (tab + http URL) for a privileged handler', () => {
    const sendResponse = makeSendResponse();
    const sender = {
      id: runtimeId,
      tab: { id: 1 },
      url: 'https://example.com',
    } as chrome.runtime.MessageSender;

    const rejected = rejectContentScriptSender(sender, sendResponse, 'MANUAL_RECORD');

    expect(rejected).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'MANUAL_RECORD is not allowed from content scripts',
    });
  });

  it('allows an extension-page sender (no tab)', () => {
    const sendResponse = makeSendResponse();
    const sender = {
      id: runtimeId,
      url: `chrome-extension://${runtimeId}/popup.html`,
    } as chrome.runtime.MessageSender;

    const rejected = rejectContentScriptSender(sender, sendResponse, 'MANUAL_RECORD');

    expect(rejected).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('rejects an external-extension sender', () => {
    const sendResponse = makeSendResponse();
    const sender = {
      id: 'some-other-extension',
    } as chrome.runtime.MessageSender;

    const rejected = rejectContentScriptSender(sender, sendResponse, 'TEST_AI');

    expect(rejected).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'TEST_AI is not allowed from external extensions',
    });
  });
});
