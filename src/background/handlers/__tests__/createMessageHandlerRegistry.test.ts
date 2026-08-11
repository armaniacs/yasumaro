import { describe, expect, it, vi } from 'vitest';
import { createMessageHandlerRegistry } from '../createMessageHandlerRegistry.js';

const registeredTypes = [
  'VALID_VISIT',
  'FETCH_URL',
  'MANUAL_RECORD',
  'PREVIEW_RECORD',
  'SAVE_RECORD',
  'CONTENT_CLEANSING_EXECUTED',
  'CHECK_DOMAIN',
  'TEST_CONNECTIONS',
  'TEST_OBSIDIAN',
  'TEST_AI',
  'GET_PRIVACY_CACHE',
  'ACTIVITY_UPDATE',
  'SESSION_LOCK_REQUEST',
  'PING',
  'REFRESH_LOCAL_MARKDOWN_SCHEDULER',
  'CONSENT_STATE_CHANGED',
  'GENERATE_REVIEW_SUMMARY',
  'LOG_FORWARD',
  'DASHBOARD_SQLITE',
] as const;

const contentScriptAllowed = new Set([
  'VALID_VISIT',
  'CONTENT_CLEANSING_EXECUTED',
  'CHECK_DOMAIN',
  'PING',
]);

function makeComposition() {
  const recordingLogic = { record: vi.fn().mockResolvedValue({ success: true }) };
  const tabCache = { add: vi.fn(), update: vi.fn() };
  const obsidian = { testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }) };
  const aiService = { testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }) };
  const pipeline = {} as never;
  const manualRecordDeps = {
    isRecordingAllowed: vi.fn().mockResolvedValue(true),
    checkRateLimit: vi.fn(),
    fetchContent: vi.fn(),
    recordingPipeline: pipeline,
    getSettings: vi.fn().mockResolvedValue({}),
    setUrlContent: vi.fn(),
  };
  const saveRecordDeps = { ...manualRecordDeps };

  return createMessageHandlerRegistry({
    runtimeId: 'extension-id',
    recordingLogic,
    tabCache,
    obsidian,
    aiService,
    manualRecordDeps,
    saveRecordDeps,
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
  });
}

describe('createMessageHandlerRegistry', () => {
  it('registers every production message type exactly once', () => {
    const composition = makeComposition();

    expect(Object.keys(composition.handlers).sort()).toEqual([...registeredTypes].sort());
    for (const type of registeredTypes) {
      const response = vi.fn();
      const accepted = composition.registry.dispatch(type, {}, { id: 'external' } as chrome.runtime.MessageSender, response);
      expect(accepted).toBe(false);
      expect(response).toHaveBeenCalledWith({ success: false, error: 'Invalid sender' });
    }
  });

  it('allows content scripts only for the explicitly permitted message types', () => {
    const composition = makeComposition();
    for (const type of registeredTypes) {
      const response = vi.fn();
      const accepted = composition.registry.dispatch(
        type,
        {},
        { id: 'extension-id', tab: { id: 1 }, url: 'https://example.com' } as chrome.runtime.MessageSender,
        response,
      );

      if (contentScriptAllowed.has(type)) {
        expect(accepted).toBe(true);
      } else {
        expect(accepted).toBe(false);
        expect(response).toHaveBeenCalledWith({
          success: false,
          error: `${type} is not allowed from content scripts`,
        });
      }
    }
  });
});
