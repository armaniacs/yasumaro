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
      recordingAdmission: { admit: vi.fn().mockResolvedValue({ settings: {} }) },
      fetchManualContent: vi.fn(),
      fetchRegenerated: vi.fn().mockResolvedValue({ content: '' }),
      setUrlContent: vi.fn(),
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

  it('rejects a forged archive cutoff pair before the handler runs (PBI 2026-09-07-21)', () => {
    const router = createMessageRouter(deps);
    const sendResponse = vi.fn();
    const sender = { id: 'test-id' } as unknown as chrome.runtime.MessageSender;

    const cutoffDate = '2026-09-01';
    const forgedMs = new Date(2026, 7, 31, 23, 59, 59, 999).getTime();
    router.dispatch(
      { type: 'DASHBOARD_SQLITE', payload: { subtype: 'archive_preview', cutoffDate, cutoffMs: forgedMs, includeDeleted: false }, protocolVersion: 1 },
      sender,
      sendResponse,
    );

    expect(deps.dashboardSqliteHandler).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: expect.stringContaining('cutoffMs does not match cutoffDate') }),
    );
  });

  it('rejects a forged archive stagingName before the handler runs (PBI 2026-09-07-21)', () => {
    const router = createMessageRouter(deps);
    const sendResponse = vi.fn();
    const sender = { id: 'test-id' } as unknown as chrome.runtime.MessageSender;

    router.dispatch(
      { type: 'DASHBOARD_SQLITE', payload: { subtype: 'archive_delete_by_staging', stagingName: 'yasumaro.db' }, protocolVersion: 1 },
      sender,
      sendResponse,
    );

    expect(deps.dashboardSqliteHandler).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: expect.stringContaining('stagingName') }),
    );
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

  it('answers OW_PROBE_QUERY disarmed without session (fail-safe)', async () => {
    const router = createMessageRouter(deps);
    const sendResponse = vi.fn();
    const sender = { id: 'test-id' } as unknown as chrome.runtime.MessageSender;

    const handled = router.dispatch({ type: 'OW_PROBE_QUERY', protocolVersion: 1 }, sender, sendResponse);
    expect(handled).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ success: true, enabled: false });
    });
  });

  it('rejects malformed OW_PROBE_STATE before the handler runs', () => {
    const router = createMessageRouter(deps);
    const sendResponse = vi.fn();
    const sender = { id: 'test-id' } as unknown as chrome.runtime.MessageSender;

    const invalidMsg = {
      type: 'OW_PROBE_STATE',
      payload: { maxScrollPercentage: 80 },
      protocolVersion: 1,
    };
    const result = router.dispatch(invalidMsg, sender, sendResponse);

    expect(result).toBe(false);
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  // PBI 2026-10-21-02: GENERATE_REVIEW_SUMMARY / LOG_FORWARD had handlers but
  // no registered validator, so dispatch's fail-open skip let invalid payloads
  // reach them unexamined.
  it('rejects a GENERATE_REVIEW_SUMMARY payload outside the period contract before the handler runs', () => {
    const router = createMessageRouter(deps);
    const sendResponse = vi.fn();
    const sender = { id: 'test-id' } as unknown as chrome.runtime.MessageSender;

    const result = router.dispatch(
      { type: 'GENERATE_REVIEW_SUMMARY', payload: { periodType: 'yearly' }, protocolVersion: 1 },
      sender,
      sendResponse,
    );

    expect(result).toBe(false);
    expect(deps.generateWeeklySummary).not.toHaveBeenCalled();
    expect(deps.generateMonthlySummary).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it('passes a valid GENERATE_REVIEW_SUMMARY through the validator to its handler', async () => {
    const router = createMessageRouter(deps);
    const sendResponse = vi.fn();
    const sender = { id: 'test-id' } as unknown as chrome.runtime.MessageSender;

    const handled = router.dispatch(
      { type: 'GENERATE_REVIEW_SUMMARY', payload: { periodType: 'weekly' }, protocolVersion: 1 },
      sender,
      sendResponse,
    );

    expect(handled).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  it('rejects a LOG_FORWARD payload with an unknown level before the handler runs', () => {
    const router = createMessageRouter(deps);
    const sendResponse = vi.fn();
    const sender = { id: 'test-id' } as unknown as chrome.runtime.MessageSender;

    const result = router.dispatch(
      { type: 'LOG_FORWARD', payload: { level: 'verbose', message: 'm', source: 'offscreen' }, protocolVersion: 1 },
      sender,
      sendResponse,
    );

    expect(result).toBe(false);
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it('passes a valid LOG_FORWARD through the validator to its handler', async () => {
    const router = createMessageRouter(deps);
    const sendResponse = vi.fn();
    const sender = { id: 'test-id' } as unknown as chrome.runtime.MessageSender;

    const handled = router.dispatch(
      { type: 'LOG_FORWARD', payload: { level: 'info', message: 'm', source: 'offscreen' }, protocolVersion: 1 },
      sender,
      sendResponse,
    );

    expect(handled).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });
});
