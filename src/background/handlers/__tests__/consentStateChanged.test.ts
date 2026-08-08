import { describe, it, expect, vi } from 'vitest';
import { createConsentStateChangedHandler } from '../messageHandlers.js';
import { MessageHandlerRegistry } from '../MessageHandlerRegistry.js';

describe('createConsentStateChangedHandler', () => {
  it('calls updateConsentBadge and responds success for a valid sender id', async () => {
    const updateConsentBadge = vi.fn().mockResolvedValue(undefined);
    const handler = createConsentStateChangedHandler({ updateConsentBadge });
    const sendResponse = vi.fn();

    const runtimeId = 'test-extension-id';
    vi.stubGlobal('chrome', {
      runtime: { id: runtimeId }
    } as unknown as typeof chrome);

    await handler({}, { id: runtimeId } as chrome.runtime.MessageSender, sendResponse);

    expect(updateConsentBadge).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({ success: true });

    vi.unstubAllGlobals();
  });

  /**
   * Sender authorization moved from the handler body to the registry, so these
   * dispatch through the registry — calling the handler directly would bypass
   * the layer that now enforces the rule.
   */
  it('rejects messages from external extensions', async () => {
    const updateConsentBadge = vi.fn().mockResolvedValue(undefined);
    const registry = new MessageHandlerRegistry('test-extension-id');
    const sendResponse = vi.fn();

    registry.register('CONSENT_STATE_CHANGED', createConsentStateChangedHandler({ updateConsentBadge }), 'extension-only');
    registry.dispatch('CONSENT_STATE_CHANGED', {}, { id: 'external-extension-id' } as chrome.runtime.MessageSender, sendResponse);
    await Promise.resolve();

    expect(updateConsentBadge).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'Invalid sender' });
  });

  it('rejects messages with a missing sender id', async () => {
    const updateConsentBadge = vi.fn().mockResolvedValue(undefined);
    const registry = new MessageHandlerRegistry('test-extension-id');
    const sendResponse = vi.fn();

    registry.register('CONSENT_STATE_CHANGED', createConsentStateChangedHandler({ updateConsentBadge }), 'extension-only');
    registry.dispatch('CONSENT_STATE_CHANGED', {}, {} as chrome.runtime.MessageSender, sendResponse);
    await Promise.resolve();

    expect(updateConsentBadge).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'Invalid sender' });
  });

  it('rejects a content script sender', async () => {
    const updateConsentBadge = vi.fn().mockResolvedValue(undefined);
    const registry = new MessageHandlerRegistry('test-extension-id');
    const sendResponse = vi.fn();

    registry.register('CONSENT_STATE_CHANGED', createConsentStateChangedHandler({ updateConsentBadge }), 'extension-only');
    registry.dispatch(
      'CONSENT_STATE_CHANGED',
      {},
      { id: 'test-extension-id', tab: { id: 4 }, url: 'https://evil.example' } as chrome.runtime.MessageSender,
      sendResponse,
    );
    await Promise.resolve();

    expect(updateConsentBadge).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'CONSENT_STATE_CHANGED is not allowed from content scripts',
    });
  });
});
