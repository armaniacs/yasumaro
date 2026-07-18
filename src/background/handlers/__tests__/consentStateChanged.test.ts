import { describe, it, expect, vi } from 'vitest';
import { createConsentStateChangedHandler } from '../messageHandlers.js';

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

  it('rejects messages from external extensions', async () => {
    const updateConsentBadge = vi.fn().mockResolvedValue(undefined);
    const handler = createConsentStateChangedHandler({ updateConsentBadge });
    const sendResponse = vi.fn();

    vi.stubGlobal('chrome', {
      runtime: { id: 'test-extension-id' }
    } as unknown as typeof chrome);

    await handler({}, { id: 'external-extension-id' } as chrome.runtime.MessageSender, sendResponse);

    expect(updateConsentBadge).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'CONSENT_STATE_CHANGED is not allowed from external extensions' });

    vi.unstubAllGlobals();
  });

  it('rejects messages with a missing sender id', async () => {
    const updateConsentBadge = vi.fn().mockResolvedValue(undefined);
    const handler = createConsentStateChangedHandler({ updateConsentBadge });
    const sendResponse = vi.fn();

    vi.stubGlobal('chrome', {
      runtime: { id: 'test-extension-id' }
    } as unknown as typeof chrome);

    await handler({}, {} as chrome.runtime.MessageSender, sendResponse);

    expect(updateConsentBadge).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'CONSENT_STATE_CHANGED is not allowed from external extensions' });

    vi.unstubAllGlobals();
  });
});
