import { describe, it, expect, vi } from 'vitest';
import { DiagnosticsCollector } from '../DiagnosticsCollector.js';

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
