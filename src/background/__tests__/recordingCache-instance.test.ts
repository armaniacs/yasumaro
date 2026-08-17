/**
 * recordingCache-instance.test.ts
 * Verifies RecordingCacheInstance is truly independent per instance when
 * backed by InMemoryRecordingCacheStore — the core value the store-injection
 * refactor exists for. RecordingCache.* (the static facade) shares one
 * module-level defaultRecordingCache and is covered by
 * recordingCache-session.test.ts instead.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSettings = vi.fn();
const mockGetSavedUrlsWithTimestamps = vi.fn();

vi.mock('../../utils/storage.js', () => ({
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
  getSavedUrlsWithTimestamps: (...args: unknown[]) => mockGetSavedUrlsWithTimestamps(...args),
}));

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { ERROR: 'error', WARN: 'warn', INFO: 'info', DEBUG: 'debug' },
}));

vi.mock('../../utils/storage/settingsStore.js', () => ({
  API_KEY_FIELDS: ['geminiApiKey'],
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
    mockGetSettings.mockResolvedValueOnce({ geminiApiKey: 'a', flag: 1 });
    mockGetSettings.mockResolvedValueOnce({ geminiApiKey: 'b', flag: 2 });

    const cacheA = new RecordingCacheInstance(new InMemoryRecordingCacheStore());
    const cacheB = new RecordingCacheInstance(new InMemoryRecordingCacheStore());

    await cacheA.getSettingsWithCache();
    await cacheB.getSettingsWithCache();

    expect(cacheA.getCacheState().settingsCache?.flag).toBe(1);
    expect(cacheB.getCacheState().settingsCache?.flag).toBe(2);
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
    mockGetSettings.mockResolvedValue({ geminiApiKey: 'secret', flag: true });

    await writer.getSettingsWithCache();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    const persisted = await store.get<{ settingsCache: { flag: boolean; geminiApiKey: string } }>(SESSION_KEYS.RECORDING_CACHE);
    expect(persisted?.settingsCache.flag).toBe(true);
    expect(persisted?.settingsCache.geminiApiKey).toBe('');
  });

  it('a second instance sharing the same store does not restore a redacted cache (no usable API key)', async () => {
    const store = new InMemoryRecordingCacheStore();
    const writer = new RecordingCacheInstance(store);
    mockGetSettings.mockResolvedValue({ geminiApiKey: 'secret', flag: true });
    await writer.getSettingsWithCache();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    const reader = new RecordingCacheInstance(store);
    await reader.loadCacheFromSession();

    // The persisted mirror has geminiApiKey redacted, so it carries no
    // usable key — hasApiKeys() rejects it and the cache stays empty.
    expect(reader.getCacheState().settingsCache).toBeNull();
  });

  it('invalidateSettingsCache resets only the instance it is called on', () => {
    const cacheA = new RecordingCacheInstance(new InMemoryRecordingCacheStore());
    const cacheB = new RecordingCacheInstance(new InMemoryRecordingCacheStore());
    cacheA.getCacheState().settingsCache = { flag: true } as never;
    cacheB.getCacheState().settingsCache = { flag: true } as never;

    cacheA.invalidateSettingsCache();

    expect(cacheA.getCacheState().settingsCache).toBeNull();
    expect(cacheB.getCacheState().settingsCache).not.toBeNull();
  });
});
