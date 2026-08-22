import { describe, it, expect, vi } from 'vitest';
import { createConsentStateChangedHandler } from '../systemHandlers.js';
import { createMessageRouter } from '../MessageRouter.js';
import type { MessageRouterDeps } from '../MessageRouter.js';

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
   * Sender authorization moved from the handler body to the MessageRouter trust
   * table, so these dispatch through the router — calling the handler directly
   * would bypass the layer that now enforces the rule.
   */
  function makeDeps(updateConsentBadge: ReturnType<typeof vi.fn>): MessageRouterDeps {
    return {
      runtimeId: 'test-extension-id',
      recordingPipeline: { record: async () => ({ success: true }) },
      tabCache: { add: () => undefined, update: () => undefined },
      obsidian: { testConnection: async () => ({ success: true }) },
      aiService: { testConnection: async () => ({ success: true }) },
      manualRecordDeps: {} as never,
      saveRecordDeps: {} as never,
      hasPrivacyConsent: async () => true,
      buildAllowedUrls: () => new Set(),
      getSettings: async () => ({}),
      isDomainAllowed: async () => true,
      clearSettingsCache: () => undefined,
      notifyAiTestProgress: () => undefined,
      getPrivacyCache: () => null,
      updateActivity: async () => undefined,
      lockSession: async () => undefined,
      autoSavedBadgeTabs: { add: () => undefined, has: () => false },
      initExportScheduler: async () => undefined,
      updateConsentBadge,
      generateWeeklySummary: async () => true,
      generateMonthlySummary: async () => true,
      dashboardSqliteHandler: () => undefined,
    };
  }

  it('rejects messages from external extensions', async () => {
    const updateConsentBadge = vi.fn().mockResolvedValue(undefined);
    const router = createMessageRouter(makeDeps(updateConsentBadge));
    const sendResponse = vi.fn();

    const handled = router.dispatch(
      { type: 'CONSENT_STATE_CHANGED', payload: {}, protocolVersion: 1 },
      { id: 'external-extension-id' } as chrome.runtime.MessageSender,
      sendResponse,
    );
    await Promise.resolve();

    expect(handled).toBe(false);
    expect(updateConsentBadge).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'CONSENT_STATE_CHANGED is not allowed from external extensions',
    });
  });

  it('rejects messages with a missing sender id', async () => {
    const updateConsentBadge = vi.fn().mockResolvedValue(undefined);
    const router = createMessageRouter(makeDeps(updateConsentBadge));
    const sendResponse = vi.fn();

    const handled = router.dispatch(
      { type: 'CONSENT_STATE_CHANGED', payload: {}, protocolVersion: 1 },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );
    await Promise.resolve();

    expect(handled).toBe(false);
    expect(updateConsentBadge).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'CONSENT_STATE_CHANGED is not allowed from external extensions',
    });
  });

  it('rejects a content script sender', async () => {
    const updateConsentBadge = vi.fn().mockResolvedValue(undefined);
    const router = createMessageRouter(makeDeps(updateConsentBadge));
    const sendResponse = vi.fn();

    const handled = router.dispatch(
      { type: 'CONSENT_STATE_CHANGED', payload: {}, protocolVersion: 1 },
      { id: 'test-extension-id', tab: { id: 4 }, url: 'https://evil.example' } as chrome.runtime.MessageSender,
      sendResponse,
    );
    await Promise.resolve();

    expect(handled).toBe(false);
    expect(updateConsentBadge).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'CONSENT_STATE_CHANGED is not allowed from content scripts',
    });
  });
});
