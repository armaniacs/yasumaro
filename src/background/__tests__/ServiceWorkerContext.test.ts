import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceWorkerContext, getGlobalContext, setGlobalContext, resetGlobalContext } from '../ServiceWorkerContext.js';

vi.mock('../tabCache.js', () => ({
  TabCache: class {
    initialize = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../Mutex.js', () => ({
  Mutex: class {},
}));

vi.mock('../obsidianClient.js', () => ({
  ObsidianClient: class {},
}));

vi.mock('../aiClient.js', () => ({
  AIClient: class {},
}));

vi.mock('../recordingLogic.js', () => ({
  RecordingLogic: class {},
}));

vi.mock('../privacyPipeline.js', () => ({
  PrivacyPipeline: class {},
}));

describe('ServiceWorkerContext', () => {
  beforeEach(() => {
    resetGlobalContext();
  });

  it('creates with default dependencies', () => {
    const ctx = new ServiceWorkerContext();
    expect(ctx).toBeDefined();
    expect(ctx.getTabCache()).toBeDefined();
    expect(ctx.getMutex()).toBeDefined();
  });

  it('creates with custom dependencies', () => {
    const mockTabCache = { initialize: vi.fn() };
    const ctx = new ServiceWorkerContext({ tabCache: mockTabCache as unknown as import('../tabCache.js').TabCache });
    expect(ctx.getTabCache()).toBe(mockTabCache);
  });

  it('getObsidianClient lazily initializes', () => {
    const ctx = new ServiceWorkerContext();
    const client = ctx.getObsidianClient();
    expect(client).toBeDefined();
  });

  it('getAIClient lazily initializes', () => {
    const ctx = new ServiceWorkerContext();
    const client = ctx.getAIClient();
    expect(client).toBeDefined();
  });

  it('getRecordingLogic lazily initializes', () => {
    const ctx = new ServiceWorkerContext();
    const logic = ctx.getRecordingLogic();
    expect(logic).toBeDefined();
  });

  it('getPrivacyPipeline returns null when not set', () => {
    const ctx = new ServiceWorkerContext();
    expect(ctx.getPrivacyPipeline()).toBeNull();
  });

  it('initialize calls tabCache.initialize', async () => {
    const ctx = new ServiceWorkerContext();
    await ctx.initialize();
    expect(ctx.getTabCache().initialize).toHaveBeenCalled();
  });

  it('setDependency updates dependency', () => {
    const ctx = new ServiceWorkerContext();
    const mockMutex = {} as import('../Mutex.js').Mutex;
    ctx.setDependency('mutex', mockMutex);
    expect(ctx.getMutex()).toBe(mockMutex);
  });
});

describe('global context', () => {
  beforeEach(() => {
    resetGlobalContext();
  });

  it('getGlobalContext creates default context', () => {
    const ctx = getGlobalContext();
    expect(ctx).toBeInstanceOf(ServiceWorkerContext);
  });

  it('getGlobalContext returns same instance', () => {
    const ctx1 = getGlobalContext();
    const ctx2 = getGlobalContext();
    expect(ctx1).toBe(ctx2);
  });

  it('setGlobalContext sets custom context', () => {
    const custom = new ServiceWorkerContext();
    setGlobalContext(custom);
    expect(getGlobalContext()).toBe(custom);
  });

  it('resetGlobalContext clears context', () => {
    getGlobalContext();
    resetGlobalContext();
    const ctx = getGlobalContext();
    expect(ctx).toBeInstanceOf(ServiceWorkerContext);
  });
});
