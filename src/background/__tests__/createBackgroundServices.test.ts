import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  ObsidianClient: vi.fn(),
  SqliteClient: vi.fn(),
  TabCache: vi.fn(),
  RateLimiter: vi.fn(),
  ManualContentFetcher: vi.fn(),
  AIClient: vi.fn(),
  LocalAIClient: vi.fn(),
  LocalAIService: vi.fn(),
  RemoteAIService: vi.fn(),
  FallbackAIService: vi.fn(),
  RecordingLogic: vi.fn(),
  SessionStore: vi.fn(),
}));

vi.mock('../obsidianClient.js', () => ({ ObsidianClient: mocks.ObsidianClient }));
vi.mock('../sqliteClient.js', () => ({ SqliteClient: mocks.SqliteClient }));
vi.mock('../tabCache.js', () => ({ TabCache: mocks.TabCache }));
vi.mock('../rateLimiter.js', () => ({ RateLimiter: mocks.RateLimiter }));
vi.mock('../manualContentFetcher.js', () => ({ ManualContentFetcher: mocks.ManualContentFetcher }));
vi.mock('../aiClient.js', () => ({ AIClient: mocks.AIClient }));
vi.mock('../localAiClient.js', () => ({ LocalAIClient: mocks.LocalAIClient }));
vi.mock('../ai/FallbackAIService.js', () => ({ FallbackAIService: mocks.FallbackAIService }));
vi.mock('../ai/LocalAIService.js', () => ({ LocalAIService: mocks.LocalAIService }));
vi.mock('../ai/RemoteAIService.js', () => ({ RemoteAIService: mocks.RemoteAIService }));
vi.mock('../recordingLogic.js', () => ({ RecordingLogic: mocks.RecordingLogic }));
vi.mock('../sessionStore.js', () => ({ SessionStore: mocks.SessionStore }));

import { createBackgroundServices } from '../createBackgroundServices.js';

describe('createBackgroundServices', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.ObsidianClient.mockImplementation(function () { return { obsidian: true }; });
    mocks.SqliteClient.mockImplementation(function () { return { sqlite: true }; });
    mocks.TabCache.mockImplementation(function () { return { tabCache: true }; });
    mocks.RateLimiter.mockImplementation(function () { return { rateLimiter: true }; });
    mocks.ManualContentFetcher.mockImplementation(function () { return { manualContentFetcher: true }; });
    mocks.AIClient.mockImplementation(function () { return { aiClient: true }; });
    mocks.LocalAIClient.mockImplementation(function () { return { localAIClient: true }; });
    mocks.LocalAIService.mockImplementation(function () { return { localAIService: true }; });
    mocks.RemoteAIService.mockImplementation(function () { return { remoteAIService: true }; });
    mocks.FallbackAIService.mockImplementation(function () { return { fallbackAIService: true }; });
    mocks.RecordingLogic.mockImplementation(function () { return { recordingLogic: true }; });
    mocks.SessionStore.mockImplementation(function () { return { sessionStore: true }; });
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
      aiClient: { aiClient: true },
      sessionStore: { sessionStore: true },
    });
  });

  it('shares a single SessionStore instance with TabCache and RateLimiter', () => {
    createBackgroundServices();

    const sessionStoreInstance = mocks.SessionStore.mock.results[0].value;
    expect(mocks.TabCache).toHaveBeenCalledWith(sessionStoreInstance);
    expect(mocks.RateLimiter).toHaveBeenCalledWith(sessionStoreInstance);
  });

  it('wires AI services through FallbackAIService', () => {
    createBackgroundServices();

    expect(mocks.LocalAIClient).toHaveBeenCalledTimes(1);
    expect(mocks.LocalAIService).toHaveBeenCalledTimes(1);
    expect(mocks.RemoteAIService).toHaveBeenCalledTimes(1);
    expect(mocks.FallbackAIService).toHaveBeenCalledTimes(1);
    expect(mocks.RecordingLogic).toHaveBeenCalledWith(
      { obsidian: true },
      { fallbackAIService: true },
      undefined,
      { sqlite: true },
    );
  });

  it('passes localAIClient and ensureOffscreenDocument callback to LocalAIService', () => {
    const ensureOffscreenDocument = vi.fn().mockResolvedValue(undefined);
    mocks.LocalAIClient.mockImplementation(function () { return { ensureOffscreenDocument }; });

    createBackgroundServices();

    const localClientInstance = mocks.LocalAIClient.mock.results[0].value;
    const config = mocks.LocalAIService.mock.calls[0][0];
    expect(config.localAiClient).toBe(localClientInstance);
    expect(typeof config.ensureOffscreenDocument).toBe('function');
  });

  it('ensureOffscreenDocument callback delegates to localAIClient', async () => {
    const ensureOffscreenDocument = vi.fn().mockResolvedValue(undefined);
    mocks.LocalAIClient.mockImplementation(function () { return { ensureOffscreenDocument }; });

    createBackgroundServices();

    const config = mocks.LocalAIService.mock.calls[0][0];
    await config.ensureOffscreenDocument();
    expect(ensureOffscreenDocument).toHaveBeenCalled();
  });
});
