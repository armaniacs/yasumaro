import { describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  hasPrivacyConsent: vi.fn().mockResolvedValue(true),
  buildAllowedUrls: vi.fn().mockReturnValue(new Set()),
  getSettings: vi.fn().mockResolvedValue({}),
  clearSettingsCache: vi.fn(),
  lockSession: vi.fn().mockResolvedValue(undefined),
  isDomainAllowed: vi.fn().mockResolvedValue(true),
  notifyAiTestProgress: vi.fn(),
  updateActivity: vi.fn().mockResolvedValue(undefined),
  getPrivacyCache: vi.fn().mockReturnValue(null),
}));

vi.mock('../../popup/privacyConsent.js', () => ({
  hasPrivacyConsent: hoisted.hasPrivacyConsent,
}));
vi.mock('../../utils/storage.js', () => ({
  buildAllowedUrls: hoisted.buildAllowedUrls,
  getSettings: hoisted.getSettings,
  clearSettingsCache: hoisted.clearSettingsCache,
  lockSession: hoisted.lockSession,
  API_KEY_FIELDS: ['obsidian_api_key', 'gemini_api_key', 'openai_api_key', 'openai_2_api_key', 'provider_api_key', 'github_pat'],
}));
vi.mock('../../utils/domainUtils.js', () => ({
  isDomainAllowed: hoisted.isDomainAllowed,
}));
vi.mock('../aiTestProgressNotifier.js', () => ({
  notifyAiTestProgress: hoisted.notifyAiTestProgress,
}));
vi.mock('../sessionAlarmsManager.js', () => ({
  updateActivity: hoisted.updateActivity,
}));
vi.mock('../recordingCache.js', () => ({
  RecordingCache: { getPrivacyCache: hoisted.getPrivacyCache },
}));

import { createMessageRegistryComposition } from '../createMessageRegistryComposition.js';

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

function makeServices() {
  const pipeline = {} as never;
  const manualRecordDeps = {
    isRecordingAllowed: vi.fn().mockResolvedValue(true),
    checkRateLimit: vi.fn(),
    fetchContent: vi.fn(),
    recordingPipeline: pipeline,
    getSettings: vi.fn().mockResolvedValue({}),
    setUrlContent: vi.fn(),
  };
  return {
    recordingLogic: { record: vi.fn().mockResolvedValue({ success: true }) },
    tabCache: { add: vi.fn(), update: vi.fn() },
    obsidian: { testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }) },
    aiService: { testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }) },
    manualRecordDeps,
    saveRecordDeps: { ...manualRecordDeps },
    reviewSummaryGenerator: {
      generateWeeklySummary: vi.fn().mockResolvedValue(true),
      generateMonthlySummary: vi.fn().mockResolvedValue(true),
    },
  } as never;
}

describe('createMessageRegistryComposition', () => {
  it('registers every production message type exactly once from BackgroundServicesComposition-shaped input', () => {
    const composition = createMessageRegistryComposition({
      services: makeServices(),
      dashboardSqliteHandler: vi.fn(),
      autoSavedBadgeTabs: { add: vi.fn(), has: vi.fn().mockReturnValue(false) },
    });

    expect(Object.keys(composition.handlers).sort()).toEqual([...registeredTypes].sort());
  });

  it('wires GET_PRIVACY_CACHE handler to RecordingCache.getPrivacyCache', async () => {
    const composition = createMessageRegistryComposition({
      services: makeServices(),
      dashboardSqliteHandler: vi.fn(),
      autoSavedBadgeTabs: { add: vi.fn(), has: vi.fn().mockReturnValue(false) },
    });
    const sendResponse = vi.fn();

    await composition.handlers.GET_PRIVACY_CACHE(
      {} as never,
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(hoisted.getPrivacyCache).toHaveBeenCalled();
  });
});
