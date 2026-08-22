/**
 * backgroundComposition.test.ts
 * Production composition contract (Candidate 2).
 *
 * Fixes that service-worker's recording paths share ONE composition: the same
 * SqliteClient (via getSharedSqliteClient, never `new SqliteClient()`), and the
 * same RecordingPipeline injected into manual/save handler deps. The handlers
 * must not rebuild a pipeline per message; a per-message fallback would make
 * these identity assertions impossible.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  ObsidianClient: vi.fn(),
  SqliteClient: vi.fn(),
  getSharedSqliteClient: vi.fn(),
  TabCache: vi.fn(),
  RateLimiter: vi.fn(),
  ManualContentFetcher: vi.fn(),
  AIClient: vi.fn(),
  BuiltInAIClient: vi.fn(),
  LocalAIService: vi.fn(),
  RemoteAIService: vi.fn(),
  FallbackAIService: vi.fn(),
  SessionStore: vi.fn(),
  HeaderDetector: vi.fn(),
  createRecordingPipeline: vi.fn(),
  buildRecordingPipelineDeps: vi.fn(),
  getPrivacyInfoWithCache: vi.fn(),
  hasPrivacyConsent: vi.fn(),
  getSettings: vi.fn(),
  saveSavedUrlEntryMetadata: vi.fn(),
  createReviewSummaryGenerator: vi.fn(),
  RecordingCacheInstance: vi.fn(),
  SessionStoreRecordingCacheStore: vi.fn(),
}));

vi.mock('../obsidianClient.js', () => ({ ObsidianClient: mocks.ObsidianClient }));
vi.mock('../sqliteClient.js', () => ({
  SqliteClient: mocks.SqliteClient,
  getSharedSqliteClient: mocks.getSharedSqliteClient,
}));
vi.mock('../tabCache.js', () => ({ TabCache: mocks.TabCache }));
vi.mock('../rateLimiter.js', () => ({ RateLimiter: mocks.RateLimiter }));
vi.mock('../manualContentFetcher.js', () => ({ ManualContentFetcher: mocks.ManualContentFetcher }));
vi.mock('../aiClient.js', () => ({ AIClient: mocks.AIClient }));
vi.mock('../builtInAIClient.js', () => ({ BuiltInAIClient: mocks.BuiltInAIClient }));
vi.mock('../ai/FallbackAIService.js', () => ({ FallbackAIService: mocks.FallbackAIService }));
vi.mock('../ai/LocalAIService.js', () => ({ LocalAIService: mocks.LocalAIService }));
vi.mock('../ai/RemoteAIService.js', () => ({ RemoteAIService: mocks.RemoteAIService }));
vi.mock('../sessionStore.js', () => ({ SessionStore: mocks.SessionStore }));
vi.mock('../headerDetector.js', () => ({ HeaderDetector: mocks.HeaderDetector }));
vi.mock('../recordingCache.js', () => ({
  RecordingCache: { getPrivacyInfoWithCache: mocks.getPrivacyInfoWithCache },
  RecordingCacheInstance: mocks.RecordingCacheInstance,
  SessionStoreRecordingCacheStore: mocks.SessionStoreRecordingCacheStore,
}));
vi.mock('../pipeline/RecordingPipeline.js', () => ({
  createRecordingPipeline: mocks.createRecordingPipeline,
  buildRecordingPipelineDeps: mocks.buildRecordingPipelineDeps,
}));
vi.mock('../../popup/privacyConsent.js', () => ({ hasPrivacyConsent: mocks.hasPrivacyConsent }));
vi.mock('../../utils/storage/encryptionSession.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getSettings: mocks.getSettings,
    buildAllowedUrls: vi.fn().mockReturnValue(new Set()),
    clearSettingsCache: vi.fn(),
    lockSession: vi.fn().mockResolvedValue(undefined),
    API_KEY_FIELDS: ['obsidian_api_key', 'gemini_api_key', 'openai_api_key', 'openai_2_api_key', 'provider_api_key', 'github_pat'],

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/settingsStore.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getSettings: mocks.getSettings,
    buildAllowedUrls: vi.fn().mockReturnValue(new Set()),
    clearSettingsCache: vi.fn(),
    lockSession: vi.fn().mockResolvedValue(undefined),
    API_KEY_FIELDS: ['obsidian_api_key', 'gemini_api_key', 'openai_api_key', 'openai_2_api_key', 'provider_api_key', 'github_pat'],

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/savedUrlRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    saveSavedUrlEntryMetadata: mocks.saveSavedUrlEntryMetadata,
    getSavedUrlsWithTimestamps: vi.fn(),

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/domainUtils.js', () => ({
  isDomainAllowed: vi.fn().mockResolvedValue(true),
}));
vi.mock('../aiTestProgressNotifier.js', () => ({
  notifyAiTestProgress: vi.fn(),
}));
vi.mock('../sessionAlarmsManager.js', () => ({
  updateActivity: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../swStatePersistence.js', () => ({
  createAutoSavedBadgeTabs: vi.fn().mockReturnValue({ add: vi.fn(), has: vi.fn().mockReturnValue(false), delete: vi.fn(), restore: vi.fn() }),
}));
vi.mock('../dashboardSqliteWiring.js', () => ({
  createDashboardSqliteMessageHandler: vi.fn().mockReturnValue(vi.fn()),
}));
vi.mock('../confirmTokenManager.js', () => ({
  ensureConfirmToken: vi.fn().mockResolvedValue('token'),
}));
vi.mock('../reviewSummaryGenerator.js', () => ({ createReviewSummaryGenerator: mocks.createReviewSummaryGenerator }));

import { createBackgroundServices } from '../createBackgroundServices.js';

describe('production composition contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.ObsidianClient.mockImplementation(function () { return { obsidian: true }; });
    mocks.SqliteClient.mockImplementation(function () { return { sqlite: true }; });
    mocks.getSharedSqliteClient.mockReturnValue({ sqlite: true });
    mocks.TabCache.mockImplementation(function () { return { tabCache: true }; });
    mocks.RateLimiter.mockImplementation(function () { return { rateLimiter: true }; });
    mocks.ManualContentFetcher.mockImplementation(function () { return { manualContentFetcher: true }; });
    mocks.AIClient.mockImplementation(function () { return { aiClient: true }; });
    mocks.BuiltInAIClient.mockImplementation(function () { return { builtInAIClient: true }; });
    mocks.LocalAIService.mockImplementation(function () { return { localAIService: true }; });
    mocks.RemoteAIService.mockImplementation(function () { return { remoteAIService: true }; });
    mocks.FallbackAIService.mockImplementation(function () { return { fallbackAIService: true }; });
    mocks.SessionStore.mockImplementation(function () { return { sessionStore: true }; });
    mocks.HeaderDetector.mockImplementation(function () { return { headerDetector: true }; });
    mocks.createRecordingPipeline.mockReturnValue({ pipeline: true });
    mocks.buildRecordingPipelineDeps.mockImplementation((deps: unknown) => deps);
    mocks.getPrivacyInfoWithCache.mockResolvedValue(null);
    mocks.hasPrivacyConsent.mockResolvedValue(true);
    mocks.getSettings.mockResolvedValue({});
    mocks.saveSavedUrlEntryMetadata.mockResolvedValue(undefined);
    mocks.createReviewSummaryGenerator.mockReturnValue({ generateWeeklySummary: vi.fn(), generateMonthlySummary: vi.fn() });
    mocks.RecordingCacheInstance.mockImplementation(function () { return { getPrivacyInfoWithCache: mocks.getPrivacyInfoWithCache, getSettingsWithCache: vi.fn().mockResolvedValue({}), getPrivacyCache: vi.fn(), getPrivacyCacheSize: vi.fn(), setPrivacyCacheEntry: vi.fn(), scheduleCacheSave: vi.fn(), loadCacheFromSession: vi.fn().mockResolvedValue(undefined), invalidateSettingsCache: vi.fn() }; });
    mocks.SessionStoreRecordingCacheStore.mockImplementation(function () { return {}; });
  });

  it('builds the SqliteClient through getSharedSqliteClient, never `new SqliteClient()`', () => {
    createBackgroundServices();

    expect(mocks.getSharedSqliteClient).toHaveBeenCalledTimes(1);
    expect(mocks.SqliteClient).not.toHaveBeenCalled();
  });

  it('shares one SqliteClient with the Dashboard SQLite handler wiring', () => {
    const composition = createBackgroundServices();

    expect(composition.sqliteClient).toBe(composition.dashboardSqliteClient);
  });

  it('injects one shared RecordingPipeline into manual and save handler deps', () => {
    const composition = createBackgroundServices();

    expect(composition.recordingPipeline).toBe(composition.manualRecordDeps.recordingPipeline);
    expect(composition.recordingPipeline).toBe(composition.saveRecordDeps.recordingPipeline);
  });

  it('builds the review summary generator once with the shared AIService and SqliteClient', () => {
    createBackgroundServices();

    expect(mocks.createReviewSummaryGenerator).toHaveBeenCalledTimes(1);
    expect(mocks.createReviewSummaryGenerator).toHaveBeenCalledWith({
      aiService: { fallbackAIService: true },
      sqliteClient: { sqlite: true },
    });
  });

  it('constructs the RecordingPipeline exactly once with the shared collaborators', () => {
    createBackgroundServices();

    expect(mocks.createRecordingPipeline).toHaveBeenCalledTimes(1);
    expect(mocks.buildRecordingPipelineDeps).toHaveBeenCalledWith(
      expect.objectContaining({
        obsidian: { obsidian: true },
        aiService: { fallbackAIService: true },
        sqliteClient: { sqlite: true },
      }),
    );
  });

  it('builds the setUrlContent closure once and shares it between the recording handlers', () => {
    const composition = createBackgroundServices();

    expect(composition.manualRecordDeps.setUrlContent).toBe(composition.saveRecordDeps.setUrlContent);
  });

  it('keeps the recording handler deps to the minimum behaviour the handlers use', () => {
    const composition = createBackgroundServices();

    for (const deps of [composition.manualRecordDeps, composition.saveRecordDeps]) {
      expect(deps).not.toHaveProperty('obsidian');
      expect(deps).not.toHaveProperty('aiService');
      expect(deps).not.toHaveProperty('sqliteClient');
      expect(deps).not.toHaveProperty('getPrivacyInfoWithCache');
    }
  });
});
