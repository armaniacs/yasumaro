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
  RecordingLogic: vi.fn(),
  SessionStore: vi.fn(),
  createRecordingPipeline: vi.fn(),
  buildRecordingPipelineDeps: vi.fn(),
  getPrivacyInfoWithCache: vi.fn(),
  hasPrivacyConsent: vi.fn(),
  getSettings: vi.fn(),
  updateSavedUrlEntry: vi.fn(),
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
vi.mock('../../utils/storage/savedUrlStore.js', () => ({ updateSavedUrlEntry: mocks.updateSavedUrlEntry }));

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
    mocks.RecordingLogic.mockImplementation(function () { return { recordingLogic: true }; });
    mocks.SessionStore.mockImplementation(function () { return { sessionStore: true }; });
    mocks.createRecordingPipeline.mockReturnValue({ pipeline: true });
    mocks.buildRecordingPipelineDeps.mockImplementation((deps: unknown) => deps);
    mocks.getPrivacyInfoWithCache.mockResolvedValue(null);
    mocks.hasPrivacyConsent.mockResolvedValue(true);
    mocks.getSettings.mockResolvedValue({});
    mocks.updateSavedUrlEntry.mockResolvedValue(undefined);
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

  it('injects the same shared RecordingPipeline into RecordingLogic', () => {
    const composition = createBackgroundServices();

    // The automatic-record path (VALID_VISIT -> recordingLogic.record) must run
    // through the same pipeline instance as the manual/save handlers, not a
    // second one built lazily inside RecordingLogic.
    const [, , injectedPipeline] = mocks.RecordingLogic.mock.calls[0];
    expect(injectedPipeline).toBe(composition.recordingPipeline);
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
});
