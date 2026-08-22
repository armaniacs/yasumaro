import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DiagnosticsCollector } from '../DiagnosticsCollector.js';
import { StorageKeys } from '../../../../utils/storage/types.js';

vi.mock('../../../dashboardSqliteService.js', () => ({
  getSqliteStatus: vi.fn(),
  getLogCount: vi.fn(),
}));

describe('DiagnosticsCollector — deep module interface', () => {
  it('collect() returns typed snapshot via single seam', async () => {
    const mockGetSettings = vi.fn().mockResolvedValue({
      OBSDIAN_PROTOCOL: 'https',
      OBSDIAN_PORT: '27124',
      OBSDIAN_API_KEY: 'test-key',
      OBSDIAN_DAILY_PATH: 'daily',
      AI_PROVIDER_PRIORITY_LIST: [{ provider: 'gemini', model: 'gemini-2.0' }],
    });
    const mockGetSqliteStatus = vi.fn().mockResolvedValue({
      initialized: true,
      path: 'OPFS:/test.db',
      fallback: false,
      fts5: true,
      compileOptions: ['ENABLE_FTS5'],
      compileOptionsSource: 'opfs-worker',
    });
    const mockGetLogCount = vi.fn().mockResolvedValue({ data: 42 });
    const mockCheckBuiltInAi = vi.fn().mockResolvedValue({ status: 'available' });
    const mockGetBytes = vi.fn().mockResolvedValue(1024 * 100);
    const mockGetDebug = vi.fn().mockResolvedValue(false);

    const collector = new DiagnosticsCollector({
      getSettings: mockGetSettings as any,
      getSqliteStatus: mockGetSqliteStatus as any,
      getLogCount: mockGetLogCount as any,
      checkBuiltInAiAvailability: mockCheckBuiltInAi as any,
      getStorageBytesInUse: mockGetBytes as any,
      getDebugMode: mockGetDebug as any,
    });

    const snapshot = await collector.collect();

    expect(snapshot).toBeDefined();
    expect(snapshot.obsidian.protocol).toBe('https');
    expect(snapshot.obsidian.port).toBe('27124');
    expect(snapshot.storage.bytesUsedKb).toBe('100.0');
    expect(snapshot.storage.savedUrls).toBe('42');
    expect(snapshot.sqlite?.initialized).toBe(true);
    expect(snapshot.aiProviders.length).toBe(1);
    expect(snapshot.aiProviders[0]?.provider).toBe('gemini');
    expect(Array.isArray(snapshot.deficiencies)).toBe(true);
    expect(typeof snapshot.debugMode).toBe('boolean');
  });

  it('handles partial failures without crashing — locality', async () => {
    const mockGetSettings = vi.fn().mockResolvedValue({});
    const mockGetSqliteStatus = vi.fn().mockRejectedValue(new Error('SQLite unavailable'));
    const mockGetLogCount = vi.fn().mockResolvedValue({ error: 'unavailable' });
    const mockCheckBuiltInAi = vi.fn().mockRejectedValue(new Error('AI check failed'));

    const collector = new DiagnosticsCollector({
      getSettings: mockGetSettings as any,
      getSqliteStatus: mockGetSqliteStatus as any,
      getLogCount: mockGetLogCount as any,
      checkBuiltInAiAvailability: mockCheckBuiltInAi as any,
      getStorageBytesInUse: vi.fn().mockResolvedValue(0) as any,
      getDebugMode: vi.fn().mockResolvedValue(false) as any,
    });

    const snapshot = await collector.collect();

    expect(snapshot).toBeDefined();
    expect(snapshot.sqlite).toBeNull();
    expect(snapshot.builtInAi).toBeNull();
    // Other fields still collected — failure is isolated
    expect(snapshot.storage).toBeDefined();
  });

  it('collect() is the test surface — no chrome.* mock needed for collector logic', async () => {
    const collector = new DiagnosticsCollector({
      getSettings: vi.fn().mockResolvedValue({}) as any,
      getSqliteStatus: vi.fn().mockResolvedValue(null) as any,
      getLogCount: vi.fn().mockResolvedValue({ error: 'x' }) as any,
      checkBuiltInAiAvailability: vi.fn().mockResolvedValue(null) as any,
      getStorageBytesInUse: vi.fn().mockResolvedValue(0) as any,
      getDebugMode: vi.fn().mockResolvedValue(false) as any,
    });

    const snapshot = await collector.collect();
    expect(snapshot).toHaveProperty('storage');
    expect(snapshot).toHaveProperty('sqlite');
    expect(snapshot).toHaveProperty('deficiencies');
  });
});

describe('DiagnosticsCollector — snapshot extensions', () => {
  const baseDeps = () => ({
    getLogCount: vi.fn().mockResolvedValue({ data: 1 }),
    checkBuiltInAiAvailability: vi.fn().mockResolvedValue(null),
    getStorageBytesInUse: vi.fn().mockResolvedValue(0),
    getDebugMode: vi.fn().mockResolvedValue(false),
    getManifest: vi.fn(() => ({ version: '0.0.0', name: 'collector-test' })),
  });

  it('flags settingsLoadFailed when getSettings rejects and falls back to defaults', async () => {
    const collector = new DiagnosticsCollector({
      ...baseDeps(),
      getSettings: vi.fn().mockRejectedValue(new Error('storage broken')),
      getSqliteStatus: vi.fn().mockResolvedValue(null),
    } as any);

    const snapshot = await collector.collect();

    expect(snapshot.settingsLoadFailed).toBe(true);
    expect(snapshot.obsidian.protocol).toBe('https');
    expect(snapshot.obsidian.port).toBe('27124');
    expect(snapshot.obsidian.apiKey).toBe('');
    expect(snapshot.aiProviderDetails.length).toBe(1);
    expect(snapshot.aiProviderDetails[0]?.provider).toBe('gemini');
  });

  it('reports settingsLoadFailed false when settings load succeeds', async () => {
    const collector = new DiagnosticsCollector({
      ...baseDeps(),
      getSettings: vi.fn().mockResolvedValue({
        [StorageKeys.OBSIDIAN_PROTOCOL]: 'http',
        [StorageKeys.AI_PROVIDER]: 'ollama',
        [StorageKeys.OLLAMA_BASE_URL]: 'http://127.0.0.1:11434',
        [StorageKeys.OLLAMA_MODEL]: 'llama3',
      }),
      getSqliteStatus: vi.fn().mockResolvedValue(null),
    } as any);

    const snapshot = await collector.collect();

    expect(snapshot.settingsLoadFailed).toBe(false);
    expect(snapshot.obsidian.protocol).toBe('http');
    expect(snapshot.aiProviderDetails).toEqual([
      { provider: 'ollama', model: 'llama3', label: 'ollama', baseUrl: 'http://127.0.0.1:11434' },
    ]);
  });

  it('collects extInfo from injected getManifest', async () => {
    const collector = new DiagnosticsCollector({
      ...baseDeps(),
      getSettings: vi.fn().mockResolvedValue({}),
      getSqliteStatus: vi.fn().mockResolvedValue(null),
      getManifest: vi.fn(() => ({ version: '9.9.9', name: 'Yasumaro Test' })),
    } as any);

    const snapshot = await collector.collect();

    expect(snapshot.extInfo).toEqual({ version: '9.9.9', name: 'Yasumaro Test' });
  });

  it.each([
    { strategy: 'opfs-async-main', fallback: true, dash: true, offscreen: true },
    { strategy: 'fallback', fallback: true, dash: false, offscreen: true },
    { strategy: 'opfs-sync-worker', fallback: false, dash: true, offscreen: false },
  ])('derives divergence for strategy=$strategy fallback=$fallback', async ({ strategy, fallback, dash, offscreen }) => {
    const collector = new DiagnosticsCollector({
      ...baseDeps(),
      getSettings: vi.fn().mockResolvedValue({}),
      getSqliteStatus: vi.fn().mockResolvedValue({
        initialized: true, path: '/x.db', fallback, fts5: true,
      }),
      detectVfsStrategy: vi.fn(() => ({ strategy })),
    } as any);

    const snapshot = await collector.collect();

    expect(snapshot.divergence).toEqual({
      dashboardDetectsOpfs: dash,
      offscreenUsesFallback: offscreen,
    });
  });

  it('maps per-provider settings into aiProviderDetails', async () => {
    const collector = new DiagnosticsCollector({
      ...baseDeps(),
      getSettings: vi.fn().mockResolvedValue({
        [StorageKeys.AI_PROVIDER_PRIORITY_LIST]: [{ provider: 'openai' }, { provider: 'lm-studio' }],
        [StorageKeys.OPENAI_BASE_URL]: 'https://api.openai.com/v1',
        [StorageKeys.OPENAI_MODEL]: 'gpt-4o-mini',
        [StorageKeys.OPENAI_API_KEY]: 'sk-test',
        [StorageKeys.LM_STUDIO_BASE_URL]: 'http://localhost:1234',
        [StorageKeys.LM_STUDIO_MODEL]: 'qwen',
      }),
      getSqliteStatus: vi.fn().mockResolvedValue(null),
    } as any);

    const snapshot = await collector.collect();

    expect(snapshot.aiProviderDetails).toEqual([
      { provider: 'openai', model: 'gpt-4o-mini', label: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test' },
      { provider: 'lm-studio', model: 'qwen', label: 'lm-studio', baseUrl: 'http://localhost:1234' },
    ]);
  });

  it('retries transient sqlite failures on the default path', async () => {
    const { getSqliteStatus } = await import('../../../dashboardSqliteService.js');
    const mocked = vi.mocked(getSqliteStatus);
    mocked.mockReset();
    mocked.mockRejectedValueOnce(new Error('sw starting'))
      .mockResolvedValueOnce({
        initialized: true, path: 'OPFS:/y.db', fallback: false, fts5: true,
      } as Awaited<ReturnType<typeof getSqliteStatus>>);

    vi.useFakeTimers();
    try {
      const collector = new DiagnosticsCollector({
        ...baseDeps(),
        getSettings: vi.fn().mockResolvedValue({}),
      } as any);

      const promise = collector.collect();
      await vi.runAllTimersAsync();
      const snapshot = await promise;

      expect(mocked).toHaveBeenCalledTimes(2);
      expect(snapshot.sqlite?.initialized).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
