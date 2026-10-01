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
  createRecordingOrchestrator: vi.fn(),
  getPrivacyInfoWithCache: vi.fn(),
  hasPrivacyConsent: vi.fn(),
  getSettings: vi.fn(),
  saveSavedUrlEntryMetadata: vi.fn(),
  createReviewSummaryGenerator: vi.fn(),
  RecordingCacheInstance: vi.fn(),
  SessionStoreRecordingCacheStore: vi.fn(),
  setSqliteHealthCheck: vi.fn(),
}));

vi.mock('../obsidianClient.js', () => ({ ObsidianClient: mocks.ObsidianClient }));
vi.mock('../sqlite/offscreenGateway.js', () => ({
  SqliteClient: mocks.SqliteClient,
  getSharedSqliteClient: mocks.getSharedSqliteClient,
  OffscreenGateway: vi.fn(),
  SqliteGateway: vi.fn(),
}));
vi.mock('../tabCache.js', () => ({ TabCache: mocks.TabCache }));
vi.mock('../rateLimiter.js', () => ({ RateLimiter: mocks.RateLimiter }));
vi.mock('../manualContentFetcher.js', () => ({ ManualContentFetcher: mocks.ManualContentFetcher }));
vi.mock('../builtInAIClient.js', () => ({ BuiltInAIClient: mocks.BuiltInAIClient }));
vi.mock('../ai/FallbackAIService.js', () => ({ FallbackAIService: mocks.FallbackAIService }));
vi.mock('../ai/LocalAIService.js', () => ({ LocalAIService: mocks.LocalAIService }));
vi.mock('../ai/RemoteAIService.js', () => ({ RemoteAIService: mocks.RemoteAIService }));
vi.mock('../sessionStore.js', async (importOriginal) => {
  // PBI 27-03: providerBreaker.ts reads SESSION_KEYS at module load, so the
  // mock must preserve the real constants and stub only the class.
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, SessionStore: mocks.SessionStore };
});
vi.mock('../headerDetector.js', () => ({ HeaderDetector: mocks.HeaderDetector }));
vi.mock('../recordingCache.js', () => ({
  RecordingCache: { getPrivacyInfoWithCache: mocks.getPrivacyInfoWithCache },
  RecordingCacheInstance: mocks.RecordingCacheInstance,
  SessionStoreRecordingCacheStore: mocks.SessionStoreRecordingCacheStore,
}));
vi.mock('../pipeline/RecordingOrchestrator.js', () => ({
  createRecordingOrchestrator: mocks.createRecordingOrchestrator,
}));
vi.mock('../../utils/storage/privacyConsent.js', () => ({ hasPrivacyConsent: mocks.hasPrivacyConsent }));
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
vi.mock('../swStatePersistence.js', () => ({
  createAutoSavedBadgeTabs: vi.fn().mockReturnValue({ add: vi.fn(), has: vi.fn().mockReturnValue(false), delete: vi.fn(), restore: vi.fn() }),
}));
vi.mock('../dashboardSqliteWiring.js', () => ({
  createDashboardSqliteMessageHandler: vi.fn().mockReturnValue(vi.fn()),
}));
vi.mock('../confirmTokenManager.js', () => ({
  ensureConfirmToken: vi.fn().mockResolvedValue('token'),
  createConfirmToken: vi.fn().mockResolvedValue('token'),
  verifyConfirmToken: vi.fn().mockResolvedValue(true),
  getConfirmToken: vi.fn().mockResolvedValue('token'),
}));
vi.mock('../reviewSummaryGenerator.js', () => ({ createReviewSummaryGenerator: mocks.createReviewSummaryGenerator }));
vi.mock('../../utils/storage/storageMaintenance.js', () => ({ setSqliteHealthCheck: mocks.setSqliteHealthCheck }));

import { createBackgroundServices } from '../createBackgroundServices.js';
import { ServiceContainer } from '../serviceContainer.js';
import { flushPendingWrites } from '../pendingChromeStorageQueue.js';

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
    mocks.createRecordingOrchestrator.mockReturnValue({ pipeline: true });
    mocks.getPrivacyInfoWithCache.mockResolvedValue(null);
    mocks.hasPrivacyConsent.mockResolvedValue(true);
    mocks.getSettings.mockResolvedValue({});
    mocks.saveSavedUrlEntryMetadata.mockResolvedValue(undefined);
    mocks.createReviewSummaryGenerator.mockReturnValue({ generateWeeklySummary: vi.fn(), generateMonthlySummary: vi.fn() });
    mocks.RecordingCacheInstance.mockImplementation(function () { return { getPrivacyInfoWithCache: mocks.getPrivacyInfoWithCache, getSettingsWithCache: vi.fn().mockResolvedValue({}), getPrivacyCache: vi.fn(), getPrivacyCacheSize: vi.fn(), setPrivacyCacheEntry: vi.fn(), scheduleCacheSave: vi.fn(), loadCacheFromSession: vi.fn().mockResolvedValue(undefined), invalidateSettingsCache: vi.fn(), ensureStorageListener: vi.fn(), invalidatePrivacyCache: vi.fn().mockResolvedValue(undefined) }; });
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
    expect(services).toHaveProperty('recordingAdmission');
    expect(services).toHaveProperty('messageRouter');
    expect(services.messageRouter.getHandlerCount()).toBe(20); // + REGENERATE_SUMMARY (PBI 2026-09-22-04)
    // dashboardSqliteHandler is internal wiring — reached via the router, not
    // exposed on the composition (PBI 04).
    expect(services).not.toHaveProperty('dashboardSqliteHandler');
    expect(services).toHaveProperty('autoSavedBadgeTabs');
  });

  it('exposes the AIService composition', () => {
    const services = createBackgroundServices();

    expect(services.aiService).toEqual({ fallbackAIService: true });
  });

  it('wires the pendingWriteQueue facade to the container singleton via manifest onReady', async () => {
    // The facade serves callers that bypass DI; if the composition root did
    // not install the container's instance, the facade's lazy default would
    // build a second queue over the same storage key with its own lock chain
    // (lost-update shape). Overriding before createBackgroundServices proves
    // the facade delegates to the container's instance.
    const fakeQueue = {
      flushPendingWrites: vi.fn().mockResolvedValue(undefined),
      enqueuePendingWrite: vi.fn(),
    };
    const container = new ServiceContainer();
    container.override('pendingWriteQueue', fakeQueue);

    createBackgroundServices(container);

    await flushPendingWrites(async () => true);

    expect(fakeQueue.flushPendingWrites).toHaveBeenCalledTimes(1);
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

    const sessionStoreInstance = mocks.SessionStore.mock.results[0]?.value;
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

    const remoteInstance = mocks.RemoteAIService.mock.results[0]?.value;
    const local = mocks.LocalAIService.mock.results[0]?.value;
    expect(mocks.FallbackAIService).toHaveBeenCalledWith({
      local,
      remote: remoteInstance,
    });
  });

  it('passes builtInAiClient to LocalAIService (Service Worker direct call, not via Offscreen)', () => {
    createBackgroundServices();

    const builtInAiClientInstance = mocks.BuiltInAIClient.mock.results[0]?.value;
    const config = mocks.LocalAIService.mock.calls[0]?.[0] as {
      localAiClient: unknown;
      ensureOffscreenDocument: unknown;
    };
    expect(config.localAiClient).toBe(builtInAiClientInstance);
    expect(config.ensureOffscreenDocument).toBeUndefined();
  });

  it('creates RemoteAIService directly (no AIClient wrapper)', () => {
    createBackgroundServices();

    expect(mocks.RemoteAIService).toHaveBeenCalledTimes(1);
    const remoteInstance = mocks.RemoteAIService.mock.results[0]?.value;
    expect(remoteInstance).toBeDefined();
  });

  it('uses getSharedSqliteClient instead of constructing a new SqliteClient', () => {
    createBackgroundServices();

    expect(mocks.getSharedSqliteClient).toHaveBeenCalledTimes(1);
    expect(mocks.SqliteClient).not.toHaveBeenCalled();
  });

  it('builds the shared RecordingAdmission pre-stage (PBI 2026-10-01-03)', () => {
    const services = createBackgroundServices();

    expect(typeof (services.recordingAdmission as unknown as { admit: unknown }).admit).toBe('function');
    // Consent is read lazily per admit — the composition must not call it.
    expect(mocks.hasPrivacyConsent).not.toHaveBeenCalled();
  });

  it('builds the shared RecordingPipeline exactly once with the shared collaborators', () => {
    createBackgroundServices();

    expect(mocks.createRecordingOrchestrator).toHaveBeenCalledTimes(1);
    expect(mocks.createRecordingOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        obsidian: { obsidian: true },
        aiService: { fallbackAIService: true },
        sqliteClient: { sqlite: true },
      }),
    );
  });

  it('wires setUrlContent through saveSavedUrlEntryMetadata without refreshing the timestamp', async () => {
    // PBI 2026-10-01-03: the setUrlContent closure is internal router wiring
    // now — dispatch a MANUAL_RECORD through the real router to prove it.
    const container = new ServiceContainer();
    container.override('recordingAdmission', { admit: async () => ({ settings: {} }) });
    container.override('recordingPipeline', { record: vi.fn().mockResolvedValue({ success: true, url: 'https://example.com' }) });
    const services = createBackgroundServices(container);

    vi.stubGlobal('chrome', {
      runtime: { id: 'test-extension-id' },
      i18n: { getMessage: vi.fn((key: string) => key) },
      storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } },
    } as unknown as typeof chrome);

    const sendResponse = vi.fn();
    services.messageRouter.dispatch(
      { type: 'MANUAL_RECORD', payload: { url: 'https://example.com', title: 'T', content: 'content', skipAi: true }, protocolVersion: 1 },
      { id: 'test-extension-id' } as chrome.runtime.MessageSender,
      sendResponse,
    );
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true })));

    expect(mocks.saveSavedUrlEntryMetadata).toHaveBeenCalledWith(
      'https://example.com',
      { content: 'content' },
      { refreshTimestamp: false, createIfMissing: false },
    );

    vi.unstubAllGlobals();
  });

  it('reuses every pre-registered container entry instead of re-registering it', () => {
    const container = new ServiceContainer();
    const tokens = [
      'sessionStore',
      'recordingCache',
      'headerDetector',
      'obsidian',
      'sqliteClient',
      'tabCache',
      'rateLimiter',
      'manualContentFetcher',
      'remoteAiService',
      'aiService',
      'settingsRepository',
      'perUrlMutexMap',
      'pendingWriteQueue',
      'reviewSummaryGenerator',
      'recordingPipeline',
      'dashboardSqliteHandler',
      'autoSavedBadgeTabs',
      'recordingAdmission',
      'messageRouter',
    ] as const;

    for (const token of tokens) {
      container.override(token, { fake: token });
    }

    const services = createBackgroundServices(container);

    // None of the real factories should have run since every token was pre-registered.
    expect(mocks.ObsidianClient).not.toHaveBeenCalled();
    expect(mocks.getSharedSqliteClient).not.toHaveBeenCalled();
    expect(mocks.TabCache).not.toHaveBeenCalled();
    expect(mocks.RateLimiter).not.toHaveBeenCalled();
    expect(mocks.ManualContentFetcher).not.toHaveBeenCalled();
    expect(mocks.RemoteAIService).not.toHaveBeenCalled();
    expect(mocks.SessionStore).not.toHaveBeenCalled();
    expect(mocks.HeaderDetector).not.toHaveBeenCalled();
    expect(mocks.createReviewSummaryGenerator).not.toHaveBeenCalled();
    expect(mocks.createRecordingOrchestrator).not.toHaveBeenCalled();

    expect(services.obsidian).toEqual({ fake: 'obsidian' });
    expect(services.sqliteClient).toEqual({ fake: 'sqliteClient' });
    expect(services.tabCache).toEqual({ fake: 'tabCache' });
    expect(services.rateLimiter).toEqual({ fake: 'rateLimiter' });
    expect(services.manualContentFetcher).toEqual({ fake: 'manualContentFetcher' });
    expect(services.aiService).toEqual({ fake: 'aiService' });
    expect(services.sessionStore).toEqual({ fake: 'sessionStore' });
    expect(services.headerDetector).toEqual({ fake: 'headerDetector' });
    expect(services.recordingCache).toEqual({ fake: 'recordingCache' });
    expect(services.reviewSummaryGenerator).toEqual({ fake: 'reviewSummaryGenerator' });
    expect(services.recordingPipeline).toEqual({ fake: 'recordingPipeline' });
    expect(services.autoSavedBadgeTabs).toEqual({ fake: 'autoSavedBadgeTabs' });
    expect(services.recordingAdmission).toEqual({ fake: 'recordingAdmission' });
    expect(services.messageRouter).toEqual({ fake: 'messageRouter' });
  });

  it('no longer wires a global setSqliteHealthCheck (port-injected via getDefaultSqliteHealthCheck)', async () => {
    // PBI 05: the utils→background global setter seam was removed. The health
    // probe now lives in storageMaintenance.getDefaultSqliteHealthCheck() and
    // callers inject it explicitly via ensureStorageQuota's argument.
    const maintain = vi.fn().mockResolvedValue({ success: true, data: true });
    mocks.getSharedSqliteClient.mockReturnValue({ sqlite: true, maintain });

    createBackgroundServices();

    expect(mocks.setSqliteHealthCheck).not.toHaveBeenCalled();
  });
});
