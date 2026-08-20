import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  ObsidianClient: vi.fn(),
  SqliteClient: vi.fn(),
  getSharedSqliteClient: vi.fn(),
  TabCache: vi.fn(),
  RateLimiter: vi.fn(),
  ManualContentFetcher: vi.fn(),
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
vi.mock('../../utils/storage.js', () => ({
  getSettings: mocks.getSettings,
  buildAllowedUrls: vi.fn().mockReturnValue(new Set()),
  clearSettingsCache: vi.fn(),
  lockSession: vi.fn().mockResolvedValue(undefined),
  API_KEY_FIELDS: ['obsidian_api_key', 'gemini_api_key', 'openai_api_key', 'openai_2_api_key', 'provider_api_key', 'github_pat'],
}));
vi.mock('../../utils/storage/savedUrlRepository.js', () => ({
  saveSavedUrlEntryMetadata: mocks.saveSavedUrlEntryMetadata,
  getSavedUrlsWithTimestamps: vi.fn(),
}));
vi.mock('../../utils/domainUtils.js', () => ({
  isDomainAllowed: vi.fn().mockResolvedValue(true),
}));
vi.mock('../aiTestProgressNotifier.js', () => ({
  notifyAiTestProgress: vi.fn(),
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
vi.mock('../handlers/createMessageHandlerRegistry.js', () => ({
  createMessageHandlerRegistry: vi.fn().mockReturnValue({
    registry: { register: vi.fn() },
    handlers: {},
    trustLevels: {},
  }),
}));
vi.mock('../reviewSummaryGenerator.js', () => ({ createReviewSummaryGenerator: mocks.createReviewSummaryGenerator }));

import { createBackgroundServices } from '../createBackgroundServices.js';

describe('createBackgroundServices', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.ObsidianClient.mockImplementation(function () { return { obsidian: true }; });
    mocks.SqliteClient.mockImplementation(function () { return { sqlite: true }; });
    mocks.getSharedSqliteClient.mockReturnValue({ sqlite: true });
    mocks.TabCache.mockImplementation(function () { return { tabCache: true }; });
    mocks.RateLimiter.mockImplementation(function () { return { rateLimiter: true }; });
    mocks.ManualContentFetcher.mockImplementation(function () { return { manualContentFetcher: true }; });
    mocks.RemoteAIService.mockImplementation(function () { return { remoteAIService: true }; });
    mocks.BuiltInAIClient.mockImplementation(function () { return { builtInAiClient: true }; });
    mocks.LocalAIService.mockImplementation(function () { return { localAIService: true }; });
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
    mocks.RecordingCacheInstance.mockImplementation(function () { return { getPrivacyInfoWithCache: mocks.getPrivacyInfoWithCache, getSettingsWithCache: vi.fn().mockResolvedValue({}), getPrivacyCache: vi.fn(), getPrivacyCacheSize: vi.fn(), setPrivacyCacheEntry: vi.fn(), scheduleCacheSave: vi.fn(), loadCacheFromSession: vi.fn().mockResolvedValue(undefined), invalidateSettingsCache: vi.fn(), invalidatePrivacyCache: vi.fn().mockResolvedValue(undefined) }; });
    mocks.SessionStoreRecordingCacheStore.mockImplementation(function () { return {}; });
  });

  it('creates and returns all background services', () => {
    const services = createBackgroundServices();

    expect(services).toHaveProperty('obsidian');
    expect(services).toHaveProperty('sqliteClient');
    expect(services).toHaveProperty('tabCache');
    expect(services).toHaveProperty('rateLimiter');
    expect(services).toHaveProperty('manualContentFetcher');
    expect(services).toHaveProperty('aiService');
    expect(services).toHaveProperty('reviewSummaryGenerator');
    expect(services).toHaveProperty('sessionStore');
    expect(services).toHaveProperty('headerDetector');
    expect(services).toHaveProperty('recordingCache');
    expect(services).toHaveProperty('recordingPipeline');
    expect(services).toHaveProperty('dashboardSqliteClient');
    expect(services).toHaveProperty('manualRecordDeps');
    expect(services).toHaveProperty('saveRecordDeps');
    expect(services).toHaveProperty('messageHandlerRegistry');
    expect(services).toHaveProperty('dashboardSqliteHandler');
    expect(services).toHaveProperty('autoSavedBadgeTabs');
  });

  it('exposes the AIService composition', () => {
    const services = createBackgroundServices();

    expect(services.aiService).toEqual({ fallbackAIService: true });
  });

  it('builds the review summary generator once with the shared AIService and SqliteClient', () => {
    const services = createBackgroundServices();

    expect(mocks.createReviewSummaryGenerator).toHaveBeenCalledTimes(1);
    expect(mocks.createReviewSummaryGenerator).toHaveBeenCalledWith({
      aiService: { fallbackAIService: true },
      sqliteClient: { sqlite: true },
    });
    expect(services.reviewSummaryGenerator).toBeDefined();
  });

  it('shares a single SessionStore instance with TabCache, RateLimiter and RecordingCache', () => {
    createBackgroundServices();

    const sessionStoreInstance = mocks.SessionStore.mock.results[0].value;
    expect(mocks.TabCache).toHaveBeenCalledWith(sessionStoreInstance);
    expect(mocks.RateLimiter).toHaveBeenCalledWith(sessionStoreInstance);
    expect(mocks.SessionStoreRecordingCacheStore).toHaveBeenCalledWith(sessionStoreInstance);
  });

  it('wires AI services through FallbackAIService', () => {
    createBackgroundServices();

    expect(mocks.BuiltInAIClient).toHaveBeenCalledTimes(1);
    expect(mocks.LocalAIService).toHaveBeenCalledTimes(1);
    expect(mocks.RemoteAIService).toHaveBeenCalledTimes(1);
    expect(mocks.FallbackAIService).toHaveBeenCalledTimes(1);

    const remoteInstance = mocks.RemoteAIService.mock.results[0].value;
    const local = mocks.LocalAIService.mock.results[0].value;
    expect(mocks.FallbackAIService).toHaveBeenCalledWith({
      local,
      remote: remoteInstance,
    });
  });

  it('passes builtInAiClient to LocalAIService (Service Worker direct call, not via Offscreen)', () => {
    createBackgroundServices();

    const builtInAiClientInstance = mocks.BuiltInAIClient.mock.results[0].value;
    const config = mocks.LocalAIService.mock.calls[0][0];
    expect(config.localAiClient).toBe(builtInAiClientInstance);
    expect(config.ensureOffscreenDocument).toBeUndefined();
  });

  it('creates RemoteAIService directly (no AIClient wrapper)', () => {
    createBackgroundServices();

    expect(mocks.RemoteAIService).toHaveBeenCalledTimes(1);
    const remoteInstance = mocks.RemoteAIService.mock.results[0].value;
    expect(remoteInstance).toBeDefined();
  });

  it('uses getSharedSqliteClient instead of constructing a new SqliteClient', () => {
    createBackgroundServices();

    expect(mocks.getSharedSqliteClient).toHaveBeenCalledTimes(1);
    expect(mocks.SqliteClient).not.toHaveBeenCalled();
  });

  it('shares one RecordingPipeline across manual and save handler deps', () => {
    const services = createBackgroundServices();

    expect(services.recordingPipeline).toBe(services.manualRecordDeps.recordingPipeline);
    expect(services.recordingPipeline).toBe(services.saveRecordDeps.recordingPipeline);
  });

  it('shares the SqliteClient with the Dashboard SQLite path', () => {
    const services = createBackgroundServices();

    expect(services.sqliteClient).toBe(services.dashboardSqliteClient);
  });

  it('builds the shared RecordingPipeline exactly once with the shared collaborators', () => {
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

  it('wires setUrlContent through saveSavedUrlEntryMetadata without refreshing the timestamp', async () => {
    const services = createBackgroundServices();

    await services.manualRecordDeps.setUrlContent('https://example.com', 'content');
    await services.saveRecordDeps.setUrlContent('https://example.com', 'content');

    expect(mocks.saveSavedUrlEntryMetadata).toHaveBeenCalledTimes(2);
    expect(mocks.saveSavedUrlEntryMetadata).toHaveBeenCalledWith(
      'https://example.com',
      { content: 'content' },
      { refreshTimestamp: false, createIfMissing: false },
    );
  });

  it('builds the setUrlContent closure once and shares it between the recording handlers', () => {
    const services = createBackgroundServices();

    expect(services.manualRecordDeps.setUrlContent).toBe(services.saveRecordDeps.setUrlContent);
  });

  it('keeps the recording handler deps to the minimum behaviour the handlers use', () => {
    const services = createBackgroundServices();

    for (const deps of [services.manualRecordDeps, services.saveRecordDeps]) {
      expect(deps).not.toHaveProperty('obsidian');
      expect(deps).not.toHaveProperty('aiService');
      expect(deps).not.toHaveProperty('sqliteClient');
      expect(deps).not.toHaveProperty('getPrivacyInfoWithCache');
    }
  });
});
