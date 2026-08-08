import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  ObsidianClient: vi.fn(),
  SqliteClient: vi.fn(),
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
}));

vi.mock('../obsidianClient.js', () => ({ ObsidianClient: mocks.ObsidianClient }));
vi.mock('../sqliteClient.js', () => ({ SqliteClient: mocks.SqliteClient }));
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
    mocks.BuiltInAIClient.mockImplementation(function () { return { builtInAIClient: true }; });
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
      aiService: { fallbackAIService: true },
      sessionStore: { sessionStore: true },
    });
  });

  it('exposes the AIService, not just the raw AIClient', () => {
    // The AIService composition used to be built and discarded, leaving
    // callers with only the raw AIClient — the dependency ADR 2026-07-27 asks
    // new code to avoid.
    const services = createBackgroundServices();

    expect(services.aiService).toEqual({ fallbackAIService: true });
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
    expect(mocks.RemoteAIService).toHaveBeenCalledTimes(1);
    expect(mocks.FallbackAIService).toHaveBeenCalledTimes(1);
    expect(mocks.RecordingLogic).toHaveBeenCalledWith(
      { obsidian: true },
      { fallbackAIService: true },
      undefined,
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
});
