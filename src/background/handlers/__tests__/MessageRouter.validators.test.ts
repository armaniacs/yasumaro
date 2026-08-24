import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createMessageRouter } from '../MessageRouter.js';
import type { MessageRouterDeps } from '../MessageRouter.js';

/**
 * Validator integration tests driven through the MessageRouter dispatch seam.
 * The router wires VALID_VISIT / DASHBOARD_SQLITE / PING with their production
 * validators, so a rejected payload must never reach the underlying handler
 * (observable through the mocked deps).
 */
describe('MessageRouter — validator integration', () => {
  let deps: MessageRouterDeps;

  beforeEach(() => {
    deps = {
      runtimeId: 'test-id',
      recordingPipeline: { record: vi.fn().mockResolvedValue({ success: true }) },
      tabCache: { add: vi.fn(), update: vi.fn() },
      obsidian: { testConnection: vi.fn().mockResolvedValue({ success: true }) },
      aiService: { testConnection: vi.fn().mockResolvedValue({ success: true }) },
      manualRecordDeps: {
        isRecordingAllowed: vi.fn().mockResolvedValue(true),
        checkRateLimit: vi.fn(),
        fetchContent: vi.fn(),
        recordingPipeline: { execute: vi.fn() } as never,
        getSettings: vi.fn().mockResolvedValue({}),
        setUrlContent: vi.fn(),
      },
      saveRecordDeps: {
        isRecordingAllowed: vi.fn().mockResolvedValue(true),
        recordingPipeline: { execute: vi.fn() } as never,
        getSettings: vi.fn().mockResolvedValue({}),
        setUrlContent: vi.fn(),
      },
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
  });

  it('rejects invalid VALID_VISIT before the handler runs', () => {
    const router = createMessageRouter(deps);
    const sendResponse = vi.fn();
    const sender = { id: 'test-id', tab: { id: 1, url: 'https://example.com' }, url: 'https://example.com' } as unknown as chrome.runtime.MessageSender;

    // Invalid: missing content
    const invalidMsg = { type: 'VALID_VISIT', payload: {}, protocolVersion: 1 };
    const result = router.dispatch(invalidMsg, sender, sendResponse);

    expect(result).toBe(false); // validator error is sync response
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it('passes valid VALID_VISIT through the validator to the pipeline', async () => {
    const router = createMessageRouter(deps);
    const sendResponse = vi.fn();
    const sender = { id: 'test-id', tab: { id: 1, url: 'https://example.com' }, url: 'https://example.com' } as unknown as chrome.runtime.MessageSender;
    const validMsg = { type: 'VALID_VISIT', payload: { content: 'hello' }, protocolVersion: 1 };

    router.dispatch(validMsg, sender, sendResponse);
    await vi.waitFor(() => {
      expect(deps.recordingPipeline.record).toHaveBeenCalled();
    });
  });

  it('rejects invalid DASHBOARD_SQLITE subtype before the handler runs', () => {
    const router = createMessageRouter(deps);
    const sendResponse = vi.fn();
    const sender = { id: 'test-id' } as unknown as chrome.runtime.MessageSender;

    const invalid = { type: 'DASHBOARD_SQLITE', payload: { subtype: 'unknown_op' }, protocolVersion: 1 };
    router.dispatch(invalid, sender, sendResponse);

    expect(deps.dashboardSqliteHandler).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it('passes valid DASHBOARD_SQLITE through to its handler', async () => {
    const router = createMessageRouter(deps);
    const sendResponse = vi.fn();
    const sender = { id: 'test-id' } as unknown as chrome.runtime.MessageSender;
    const valid = { type: 'DASHBOARD_SQLITE', payload: { subtype: 'status' }, protocolVersion: 1 };

    router.dispatch(valid, sender, sendResponse);
    await vi.waitFor(() => {
      expect(deps.dashboardSqliteHandler).toHaveBeenCalled();
    });
  });

  it('handles PING which has no validator registered', async () => {
    const router = createMessageRouter(deps);
    const sendResponse = vi.fn();
    const sender = { id: 'test-id' } as unknown as chrome.runtime.MessageSender;

    const handled = router.dispatch({ type: 'PING', protocolVersion: 1 }, sender, sendResponse);
    expect(handled).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });
});
