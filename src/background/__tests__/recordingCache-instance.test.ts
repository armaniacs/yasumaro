/**
 * recordingCache-instance.test.ts
 * Verifies RecordingCacheInstance is truly independent per instance when
 * backed by InMemoryRecordingCacheStore — the core value the store-injection
 * refactor exists for. RecordingCache.* (the static facade) shares one
 * module-level defaultRecordingCache and is covered by
 * recordingCache-session.test.ts instead.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetAll = vi.hoisted(() => vi.fn());
const mockGetSavedUrlsWithTimestamps = vi.hoisted(() => vi.fn());

vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    settingsRepository: {
      getAll: mockGetAll,
      setAll: vi.fn(),
      getMany: vi.fn(),
    },
    SettingsRepository: class {
      getAll = mockGetAll;
      setAll = vi.fn();
      getMany = vi.fn();
    },
  };
});

vi.mock('../../utils/storage/savedUrlRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getSavedUrlsWithTimestamps: (...args: unknown[]) => mockGetSavedUrlsWithTimestamps(...args),
  };
});

vi.mock('../../utils/storage/settingsMigration.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    API_KEY_FIELDS: ['geminiApiKey'],
  };
});
vi.mock('../../utils/storage.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    API_KEY_FIELDS: ['geminiApiKey'],
  };
});

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { ERROR: 'error', WARN: 'warn', INFO: 'info', DEBUG: 'debug' },
}));

import { RecordingCacheInstance, InMemoryRecordingCacheStore } from '../recordingCache.js';
import { SESSION_KEYS } from '../sessionStore.js';

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { session: undefined },
  };
});

describe('RecordingCacheInstance — per-instance isolation', () => {
  it('two instances with separate InMemoryRecordingCacheStore do not share settings cache state', async () => {
    mockGetAll.mockResolvedValueOnce({ geminiApiKey: 'a', flag: 1 });
    mockGetAll.mockResolvedValueOnce({ geminiApiKey: 'b', flag: 2 });

    const cacheA = new RecordingCacheInstance(new InMemoryRecordingCacheStore());
    const cacheB = new RecordingCacheInstance(new InMemoryRecordingCacheStore());

    await cacheA.getSettingsWithCache();
    await cacheB.getSettingsWithCache();

    // Cache-hit reads return the per-instance objects without refetching.
    expect((await cacheA.getSettingsWithCache()).flag).toBe(1);
    expect((await cacheB.getSettingsWithCache()).flag).toBe(2);
  });

  it('two instances with separate InMemoryRecordingCacheStore do not share privacy cache state', () => {
    const cacheA = new RecordingCacheInstance(new InMemoryRecordingCacheStore());
    const cacheB = new RecordingCacheInstance(new InMemoryRecordingCacheStore());

    cacheA.setPrivacyCacheEntry('https://a.example', { isPrivate: true, timestamp: Date.now() } as never);

    expect(cacheA.getPrivacyCache()?.has('https://a.example')).toBe(true);
    expect(cacheB.getPrivacyCache()).toBeNull();
  });

  it('persists to its own injected store with API keys redacted (VULN-014)', async () => {
    const store = new InMemoryRecordingCacheStore();
    const writer = new RecordingCacheInstance(store);
    mockGetAll.mockResolvedValue({ geminiApiKey: 'secret', flag: true });

    await writer.getSettingsWithCache();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    const persisted = await store.get<{ settingsCache: { flag: boolean; geminiApiKey: string } }>(SESSION_KEYS.RECORDING_CACHE);
    expect(persisted?.settingsCache.flag).toBe(true);
    expect(persisted?.settingsCache.geminiApiKey).toBe('');
  });

  it('a second instance sharing the same store does not restore a redacted cache (no usable API key)', async () => {
    const store = new InMemoryRecordingCacheStore();
    const writer = new RecordingCacheInstance(store);
    mockGetAll.mockResolvedValue({ geminiApiKey: 'secret', flag: true });
    await writer.getSettingsWithCache();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    const reader = new RecordingCacheInstance(store);
    await reader.loadCacheFromSession();

    // The persisted mirror has geminiApiKey redacted, so it carries no
    // usable key — hasApiKeys() rejects it and the cache stays empty.
    // Proved behaviorally: the next read misses and refetches from the repo.
    mockGetAll.mockClear();
    mockGetAll.mockResolvedValue({ fresh: true } as never);
    const settings = await reader.getSettingsWithCache();
    expect(mockGetAll).toHaveBeenCalledTimes(1);
    expect((settings as unknown as { fresh: boolean }).fresh).toBe(true);
  });

  it('invalidateSettingsCache resets only the instance it is called on', async () => {
    mockGetAll.mockResolvedValue({ flag: true } as never);
    const cacheA = new RecordingCacheInstance(new InMemoryRecordingCacheStore());
    const cacheB = new RecordingCacheInstance(new InMemoryRecordingCacheStore());
    await cacheA.getSettingsWithCache();
    await cacheB.getSettingsWithCache();
    mockGetAll.mockClear();

    cacheA.invalidateSettingsCache();

    // A refetches (stale), B hits (fresh) — exactly one repo read.
    await cacheA.getSettingsWithCache();
    await cacheB.getSettingsWithCache();
    expect(mockGetAll).toHaveBeenCalledTimes(1);
  });
});
