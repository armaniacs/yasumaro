import { describe, it, expect, vi } from 'vitest';
import { checkSenderTrust } from '../senderTrust.js';
import { MessageHandlerRegistry } from '../MessageHandlerRegistry.js';

const RUNTIME_ID = 'this-extension-id';

/** A content script: runs in a tab, on a web page URL. */
const contentScriptSender: chrome.runtime.MessageSender = {
  id: RUNTIME_ID,
  tab: { id: 7 } as chrome.tabs.Tab,
  url: 'https://example.com/article',
};

/** The popup / dashboard / options page. */
const extensionPageSender: chrome.runtime.MessageSender = {
  id: RUNTIME_ID,
  url: 'chrome-extension://this-extension-id/dashboard.html',
};

/** The offscreen document: extension URL, and no tab at all. */
const offscreenSender: chrome.runtime.MessageSender = {
  id: RUNTIME_ID,
  url: 'chrome-extension://this-extension-id/offscreen.html',
};

const externalSender: chrome.runtime.MessageSender = {
  id: 'some-other-extension',
  url: 'chrome-extension://some-other-extension/evil.html',
};

describe('checkSenderTrust', () => {
  describe('extension-only', () => {
    it('rejects content scripts', () => {
      const decision = checkSenderTrust(contentScriptSender, 'extension-only', 'TEST_AI', RUNTIME_ID);
      expect(decision.allowed).toBe(false);
      expect(decision.error).toContain('not allowed from content scripts');
    });

    it('allows extension pages', () => {
      expect(checkSenderTrust(extensionPageSender, 'extension-only', 'TEST_AI', RUNTIME_ID).allowed).toBe(true);
    });

    it('allows the offscreen document', () => {
      expect(checkSenderTrust(offscreenSender, 'extension-only', 'LOG_FORWARD', RUNTIME_ID).allowed).toBe(true);
    });
  });

  describe('content-script-allowed', () => {
    it('allows content scripts', () => {
      expect(checkSenderTrust(contentScriptSender, 'content-script-allowed', 'VALID_VISIT', RUNTIME_ID).allowed).toBe(true);
    });

    it('still allows extension pages', () => {
      expect(checkSenderTrust(extensionPageSender, 'content-script-allowed', 'PING', RUNTIME_ID).allowed).toBe(true);
    });
  });

  describe('external extensions', () => {
    it('rejects them regardless of trust level', () => {
      for (const level of ['extension-only', 'content-script-allowed'] as const) {
        const decision = checkSenderTrust(externalSender, level, 'PING', RUNTIME_ID);
        expect(decision.allowed).toBe(false);
        expect(decision.error).toContain('not allowed from external extensions');
      }
    });
  });
});

describe('MessageHandlerRegistry — trust enforcement', () => {
  it('does not invoke an extension-only handler for a content script', () => {
    const registry = new MessageHandlerRegistry(RUNTIME_ID);
    const handler = vi.fn();
    const sendResponse = vi.fn();

    registry.register('TEST_AI', handler, 'extension-only');
    const handled = registry.dispatch('TEST_AI', {}, contentScriptSender, sendResponse);

    expect(handler).not.toHaveBeenCalled();
    expect(handled).toBe(false);
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'TEST_AI is not allowed from content scripts',
    });
  });

  it('invokes an extension-only handler for an extension page', () => {
    const registry = new MessageHandlerRegistry(RUNTIME_ID);
    const handler = vi.fn();
    const sendResponse = vi.fn();

    registry.register('TEST_AI', handler, 'extension-only');
    registry.dispatch('TEST_AI', {}, extensionPageSender, sendResponse);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('invokes a content-script-allowed handler for a content script', () => {
    const registry = new MessageHandlerRegistry(RUNTIME_ID);
    const handler = vi.fn();
    const sendResponse = vi.fn();

    registry.register('VALID_VISIT', handler, 'content-script-allowed');
    registry.dispatch('VALID_VISIT', {}, contentScriptSender, sendResponse);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  /**
   * REFRESH_LOCAL_MARKDOWN_SCHEDULER previously had no per-handler guard, so a
   * content script could reach it. Only the dashboard sends it.
   */
  it('blocks a content script from restarting the export scheduler', () => {
    const registry = new MessageHandlerRegistry(RUNTIME_ID);
    const handler = vi.fn();
    const sendResponse = vi.fn();

    registry.register('REFRESH_LOCAL_MARKDOWN_SCHEDULER', handler, 'extension-only');
    registry.dispatch('REFRESH_LOCAL_MARKDOWN_SCHEDULER', {}, contentScriptSender, sendResponse);

    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects external extensions before reaching the handler', () => {
    const registry = new MessageHandlerRegistry(RUNTIME_ID);
    const handler = vi.fn();
    const sendResponse = vi.fn();

    registry.register('PING', handler, 'content-script-allowed');
    registry.dispatch('PING', {}, externalSender, sendResponse);

    expect(handler).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'Invalid sender' });
  });
});
