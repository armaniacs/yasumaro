import { describe, it, expect, vi } from 'vitest';
import { checkSenderTrust } from '../senderTrust.js';
import { createMessageRouter } from '../MessageRouter.js';
import type { MessageRouterDeps } from '../MessageRouter.js';

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

/**
 * Trust enforcement driven through the MessageRouter dispatch seam with the
 * production handler table. The router's trust levels are fixed per type, so
 * each case picks a real type whose level matches the scenario.
 */
describe('MessageRouter — trust enforcement', () => {
  function makeDeps(): MessageRouterDeps {
    return {
      runtimeId: RUNTIME_ID,
      recordingPipeline: { record: vi.fn().mockResolvedValue({ success: true }) },
      tabCache: { add: vi.fn(), update: vi.fn() },
      obsidian: { testConnection: vi.fn().mockResolvedValue({ success: true }) },
      aiService: { testConnection: vi.fn().mockResolvedValue({ success: true }) },
      manualRecordDeps: {} as never,
      saveRecordDeps: {} as never,
      hasPrivacyConsent: vi.fn().mockResolvedValue(true),
      buildAllowedUrls: vi.fn().mockReturnValue(new Set()),
      getSettings: vi.fn().mockResolvedValue({}),
      isDomainAllowed: vi.fn().mockResolvedValue(true),
      clearSettingsCache: vi.fn(),
      notifyAiTestProgress: vi.fn(),
      getPrivacyCache: vi.fn().mockReturnValue(null),
      updateActivity: vi.fn().mockResolvedValue(undefined),
      lockSession: vi.fn().mockResolvedValue(undefined),
      autoSavedBadgeTabs: { add: vi.fn(), has: vi.fn().mockReturnValue(false) },
      initExportScheduler: vi.fn().mockResolvedValue(undefined),
      updateConsentBadge: vi.fn().mockResolvedValue(undefined),
      generateWeeklySummary: vi.fn().mockResolvedValue(true),
      generateMonthlySummary: vi.fn().mockResolvedValue(true),
      dashboardSqliteHandler: vi.fn(),
    };
  }

  it('does not run the extension-only TEST_AI handler for a content script', () => {
    const deps = makeDeps();
    const router = createMessageRouter(deps);
    const sendResponse = vi.fn();

    const handled = router.dispatch(
      { type: 'TEST_AI', payload: {}, protocolVersion: 1 },
      contentScriptSender,
      sendResponse,
    );

    expect(handled).toBe(false);
    expect(deps.aiService.testConnection).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'TEST_AI is not allowed from content scripts',
    });
  });

  it('runs the extension-only TEST_AI handler for an extension page', async () => {
    const deps = makeDeps();
    const router = createMessageRouter(deps);
    const sendResponse = vi.fn();

    router.dispatch(
      { type: 'TEST_AI', payload: {}, protocolVersion: 1 },
      extensionPageSender,
      sendResponse,
    );

    await vi.waitFor(() => {
      expect(deps.aiService.testConnection).toHaveBeenCalled();
    });
  });

  it('runs a content-script-allowed PING handler for a content script', async () => {
    const router = createMessageRouter(makeDeps());
    const sendResponse = vi.fn();

    const handled = router.dispatch({ type: 'PING', protocolVersion: 1 }, contentScriptSender, sendResponse);

    expect(handled).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  /**
   * REFRESH_LOCAL_MARKDOWN_SCHEDULER previously had no per-handler guard, so a
   * content script could reach it. Only the dashboard sends it.
   */
  it('blocks a content script from restarting the export scheduler', () => {
    const deps = makeDeps();
    const router = createMessageRouter(deps);
    const sendResponse = vi.fn();

    const handled = router.dispatch(
      { type: 'REFRESH_LOCAL_MARKDOWN_SCHEDULER', payload: {}, protocolVersion: 1 },
      contentScriptSender,
      sendResponse,
    );

    expect(handled).toBe(false);
    expect(deps.initExportScheduler).not.toHaveBeenCalled();
  });

  it('rejects external extensions before reaching the handler', () => {
    const deps = makeDeps();
    const router = createMessageRouter(deps);
    const sendResponse = vi.fn();

    const handled = router.dispatch({ type: 'PING', protocolVersion: 1 }, externalSender, sendResponse);

    expect(handled).toBe(false);
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'PING is not allowed from external extensions',
    });
  });
});
