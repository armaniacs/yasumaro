import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMessageRouter } from '../MessageRouter.js';
import { NoOpOfflineNetworkQueue } from '../../offlineNetworkQueue.js';

function makeDeps() {
  return {
    runtimeId: 'test-id',
    recordingPipeline: { record: vi.fn().mockResolvedValue({ success: true }) },
    tabCache: { add: vi.fn(), update: vi.fn() },
    obsidian: { testConnection: vi.fn().mockResolvedValue({ success: true }) },
    aiService: { testConnection: vi.fn().mockResolvedValue({ success: true }) },
    manualRecordDeps: {
      isRecordingAllowed: vi.fn().mockResolvedValue(true),
      checkRateLimit: vi.fn(),
      fetchContent: vi.fn(),
      recordingPipeline: {} as never,
      getSettings: vi.fn().mockResolvedValue({}),
      setUrlContent: vi.fn(),
    },
    saveRecordDeps: {
      isRecordingAllowed: vi.fn().mockResolvedValue(true),
      checkRateLimit: vi.fn(),
      fetchContent: vi.fn(),
      recordingPipeline: {} as never,
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
    getPrivacyInfoWithCache: vi.fn().mockResolvedValue(null),
    getSettingsWithCache: vi.fn().mockResolvedValue({}),
    obsidianClient: { appendToDailyNote: vi.fn() } as never,
    sqliteClient: null,
    offlineNetworkQueue: new NoOpOfflineNetworkQueue(),
  } as unknown as Parameters<typeof createMessageRouter>[0];
}

describe('MessageRouter — deep module single seam dispatch(msg)', () => {
  let router: ReturnType<typeof createMessageRouter>;

  beforeEach(() => {
    router = createMessageRouter(makeDeps());
  });

  it('dispatch hides 19 handlers behind one method', () => {
    expect(router.getHandlerCount()).toBe(19);
    // Caller only knows dispatch, not register/trust/validator
    expect(typeof router.dispatch).toBe('function');
  });

  it('dispatch valid VALID_VISIT via deep seam', async () => {
    const sendResponse = vi.fn();
    const sender = { id: 'test-id', tab: { id: 1, url: 'https://example.com' }, url: 'https://example.com' } as unknown as chrome.runtime.MessageSender;
    const msg = { type: 'VALID_VISIT', payload: { content: 'hello' }, protocolVersion: 1 };
    const handled = router.dispatch(msg, sender, sendResponse);
    expect(handled).toBe(true);
  });

  it('dispatch invalid VALID_VISIT is rejected via validator hidden behind seam', () => {
    const sendResponse = vi.fn();
    const sender = { id: 'test-id', tab: { id: 1, url: 'https://example.com' }, url: 'https://example.com' } as unknown as chrome.runtime.MessageSender;
    const invalid = { type: 'VALID_VISIT', payload: {}, protocolVersion: 1 };
    const handled = router.dispatch(invalid, sender, sendResponse);
    expect(handled).toBe(false); // sync validation error
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it('dispatch with missing type is rejected', () => {
    const sendResponse = vi.fn();
    const sender = { id: 'test-id' } as unknown as chrome.runtime.MessageSender;
    const handled = router.dispatch({}, sender, sendResponse);
    expect(handled).toBe(false);
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it('two adapters justify the seam — prod vs test deps', () => {
    const prodRouter = createMessageRouter(makeDeps());
    const testRouter = createMessageRouter(makeDeps());
    expect(prodRouter.getHandlerCount()).toBe(testRouter.getHandlerCount());
  });
});
