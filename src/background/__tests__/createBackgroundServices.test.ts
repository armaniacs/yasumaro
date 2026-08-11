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
  RecordingLogic: vi.fn(),
  SessionStore: vi.fn(),
  createRecordingPipeline: vi.fn(),
  buildRecordingPipelineDeps: vi.fn(),
  getPrivacyInfoWithCache: vi.fn(),
  hasPrivacyConsent: vi.fn(),
  getSettings: vi.fn(),
  saveSavedUrlEntryMetadata: vi.fn(),
  createReviewSummaryGenerator: vi.fn(),
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
vi.mock('../recordingLogic.js', () => ({ RecordingLogic: mocks.RecordingLogic }));
vi.mock('../sessionStore.js', () => ({ SessionStore: mocks.SessionStore }));
vi.mock('../recordingCache.js', () => ({ RecordingCache: { getPrivacyInfoWithCache: mocks.getPrivacyInfoWithCache } }));
vi.mock('../pipeline/RecordingPipeline.js', () => ({
  createRecordingPipeline: mocks.createRecordingPipeline,
  buildRecordingPipelineDeps: mocks.buildRecordingPipelineDeps,
}));
vi.mock('../../popup/privacyConsent.js', () => ({ hasPrivacyConsent: mocks.hasPrivacyConsent }));
vi.mock('../../utils/storage.js', () => ({ getSettings: mocks.getSettings }));
vi.mock('../../utils/storage/savedUrlStore.js', () => ({ saveSavedUrlEntryMetadata: mocks.saveSavedUrlEntryMetadata }));
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
    mocks.AIClient.mockImplementation(function () { return { aiClient: true, remoteAiService: { remoteAIService: true } }; });
    mocks.BuiltInAIClient.mockImplementation(function () { return { builtInAiClient: true }; });
    mocks.LocalAIService.mockImplementation(function () { return { localAIService: true }; });
    mocks.FallbackAIService.mockImplementation(function () { return { fallbackAIService: true }; });
    mocks.RecordingLogic.mockImplementation(function () { return { recordingLogic: true }; });
    mocks.SessionStore.mockImplementation(function () { return { sessionStore: true }; });
    mocks.createRecordingPipeline.mockReturnValue({ pipeline: true });
    mocks.buildRecordingPipelineDeps.mockImplementation((deps: unknown) => deps);
    mocks.getPrivacyInfoWithCache.mockResolvedValue(null);
    mocks.hasPrivacyConsent.mockResolvedValue(true);
    mocks.getSettings.mockResolvedValue({});
    mocks.saveSavedUrlEntryMetadata.mockResolvedValue(undefined);
    mocks.createReviewSummaryGenerator.mockReturnValue({ generateWeeklySummary: vi.fn(), generateMonthlySummary: vi.fn() });
  });

  it('creates and returns all background services', () => {
    const services = createBackgroundServices();

    expect(services).toEqual({
      obsidian: { obsidian: true },
      sqliteClient: { sqlite: true },
      recordingLogic: { recordingLogic: true },
      tabCache: { tabCache: true },
      rateLimiter: { rateLimiter: true },
      manualContentFetcher: { manualContentFetcher: true },
      aiClient: { aiClient: true, remoteAiService: { remoteAIService: true } },
      aiService: { fallbackAIService: true },
      reviewSummaryGenerator: expect.any(Object),
      sessionStore: { sessionStore: true },
      recordingPipeline: { pipeline: true },
      dashboardSqliteClient: { sqlite: true },
      manualRecordDeps: expect.any(Object),
      saveRecordDeps: expect.any(Object),
    });
  });

  it('exposes the AIService, not just the raw AIClient', () => {
    // The AIService composition used to be built and discarded, leaving
    // callers with only the raw AIClient — the dependency ADR 2026-07-27 asks
    // new code to avoid.
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

  it('shares a single SessionStore instance with TabCache and RateLimiter', () => {
    createBackgroundServices();

    const sessionStoreInstance = mocks.SessionStore.mock.results[0].value;
    expect(mocks.TabCache).toHaveBeenCalledWith(sessionStoreInstance);
    expect(mocks.RateLimiter).toHaveBeenCalledWith(sessionStoreInstance);
  });

  it('wires AI services through FallbackAIService', () => {
    createBackgroundServices();

    expect(mocks.BuiltInAIClient).toHaveBeenCalledTimes(1);
    expect(mocks.LocalAIService).toHaveBeenCalledTimes(1);
    expect(mocks.AIClient).toHaveBeenCalledTimes(1);
    expect(mocks.FallbackAIService).toHaveBeenCalledTimes(1);

    const aiClientInstance = mocks.AIClient.mock.results[0].value;
    const local = mocks.LocalAIService.mock.results[0].value;
    expect(mocks.FallbackAIService).toHaveBeenCalledWith({
      local,
      remote: aiClientInstance.remoteAiService,
    });
    expect(mocks.RecordingLogic).toHaveBeenCalledWith(
      { obsidian: true },
      { fallbackAIService: true },
      { pipeline: true },
      { sqlite: true },
    );
  });

  it('passes builtInAiClient to LocalAIService (Service Worker直接呼び出し、Offscreen非経由)', () => {
    createBackgroundServices();

    const builtInAiClientInstance = mocks.BuiltInAIClient.mock.results[0].value;
    const config = mocks.LocalAIService.mock.calls[0][0];
    expect(config.localAiClient).toBe(builtInAiClientInstance);
    expect(config.ensureOffscreenDocument).toBeUndefined();
  });

  it('creates AIClient with default providers including built-in-ai Strategy', () => {
    createBackgroundServices();

    expect(mocks.AIClient).toHaveBeenCalledTimes(1);
    // AIClient constructor calls registerDefaultProviders which includes 'built-in-ai'
    const aiClientInstance = mocks.AIClient.mock.results[0].value;
    expect(aiClientInstance).toBeDefined();
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
