/**
 * recordingCache-session.test.ts
 * PBI 2026-08-08-06: recordingCache.ts の未カバー領域を埋める
 *
 * 既存テストのカバー状況（調査済み）:
 *   - recordingLogic-cache.test.ts  → getSettingsWithCache / invalidateSettingsCache / TTL
 *   - recordingLogic-redact.test.ts → redactSettingsApiKeys 単体（VULN-014）
 *   - headerDetector.test.ts        → privacyCache の書き込み・LRU退避
 *
 * 未カバーだったのはここ:
 *   1. session storage への永続化と復元の往復（loadCacheFromSession / scheduleCacheSave）
 *   2. VULN-014 が「永続化の境界」で効いていること
 *      （redactSettingsApiKeys 単体ではなく、実際に session へ書く経路）
 *   3. 復元時の TTL 判定（期限切れキャッシュを復元しない）
 *   4. getSavedUrlsWithCache / invalidateUrlCache のキャッシュ挙動
 *   5. getPrivacyInfoWithCache の session storage フォールバック
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
    API_KEY_FIELDS: ['geminiApiKey', 'providerApiKey', 'obsidianApiKey'],
  };
});
vi.mock('../../utils/storage.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    API_KEY_FIELDS: ['geminiApiKey', 'providerApiKey', 'obsidianApiKey'],
  };
});

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { ERROR: 'error', WARN: 'warn', INFO: 'info', DEBUG: 'debug' },
}));

import {
  RecordingCacheInstance,
  redactSettingsApiKeys,
  SETTINGS_CACHE_TTL,
  URL_CACHE_TTL,
  PRIVACY_CACHE_TTL,
} from '../recordingCache.js';
import type { RecordingCacheStore } from '../recordingCache.js';
import { SESSION_KEYS } from '../sessionStore.js';

/** In-memory stand-in for chrome.storage.session. */
let sessionData: Record<string, unknown> = {};

/** Store implementation that mirrors the production SessionStoreRecordingCacheStore
 *  but writes to the test-local sessionData object instead of chrome.storage.session. */
class SessionDataRecordingCacheStore implements RecordingCacheStore {
  async get<T>(key: string): Promise<T | null> {
    return (sessionData[key] as T | undefined) ?? null;
  }

  async set(key: string, value: unknown): Promise<void> {
    sessionData[key] = value;
  }
}

function installChromeSessionMock(): void {
  const session = {
    get: vi.fn(async (key: string | null) => {
      if (key === null) return { ...sessionData };
      return key in sessionData ? { [key]: sessionData[key] } : {};
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(sessionData, items);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete sessionData[k];
    }),
  };
  (globalThis as unknown as { chrome: unknown }).chrome = { storage: { session } };
}

/** Let the queueMicrotask-based debounced save run. */
async function flushSave(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

let cache: RecordingCacheInstance;

beforeEach(() => {
  sessionData = {};
  vi.clearAllMocks();
  installChromeSessionMock();
  cache = new RecordingCacheInstance(new SessionDataRecordingCacheStore());
  mockGetAll.mockResolvedValue({ geminiApiKey: 'secret-key', someFlag: true });
  mockGetSavedUrlsWithTimestamps.mockResolvedValue(new Map([['https://example.com', 1700000000000]]));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RecordingCache — session storage persistence', () => {
  it('VULN-014: never writes decrypted API keys to session storage', async () => {
    await cache.getSettingsWithCache();
    await flushSave();

    const persisted = sessionData[SESSION_KEYS.RECORDING_CACHE] as
      { settingsCache: Record<string, unknown> } | undefined;

    expect(persisted).toBeDefined();
    // The in-memory cache keeps the real key for API calls...
    const live = (await cache.getSettingsWithCache()) as unknown as Record<string, unknown>;
    expect(live['geminiApiKey']).toBe('secret-key');
    // ...but the persisted mirror must not carry it.
    expect(persisted!.settingsCache.geminiApiKey).toBe('');
    expect(JSON.stringify(persisted)).not.toContain('secret-key');
  });

  it('restores a fresh settings cache from session storage', async () => {
    const now = Date.now();
    sessionData[SESSION_KEYS.RECORDING_CACHE] = {
      settingsCache: { geminiApiKey: 'restored-key', someFlag: false },
      cacheTimestamp: now,
      cacheVersion: 7,
      urlCache: null,
      urlCacheTimestamp: null,
      privacyCache: null,
      privacyCacheTimestamp: null,
    };

    await cache.loadCacheFromSession();

    // Restored state is proved through the cache-hit read (no refetch).
    mockGetAll.mockClear();
    const live = (await cache.getSettingsWithCache()) as unknown as Record<string, unknown>;
    expect(live['someFlag']).toBe(false);
    expect(mockGetAll).not.toHaveBeenCalled();
  });

  it('does not restore a settings cache older than its TTL', async () => {
    sessionData[SESSION_KEYS.RECORDING_CACHE] = {
      settingsCache: { geminiApiKey: 'stale-key' },
      cacheTimestamp: Date.now() - SETTINGS_CACHE_TTL - 1000,
      cacheVersion: 3,
      urlCache: null,
      urlCacheTimestamp: null,
      privacyCache: null,
      privacyCacheTimestamp: null,
    };

    await cache.loadCacheFromSession();

    // Stale cache stays unrestored: the next read misses and refetches.
    mockGetAll.mockClear();
    await cache.getSettingsWithCache();
    expect(mockGetAll).toHaveBeenCalledTimes(1);
  });

  it('VULN-014: does not restore a redacted settings cache (no usable API key)', async () => {
    // What saveCacheToSession actually writes: keys emptied. Restoring that
    // would hand the recorder a settings object whose API calls all fail.
    sessionData[SESSION_KEYS.RECORDING_CACHE] = {
      settingsCache: { geminiApiKey: '', providerApiKey: '', someFlag: true },
      cacheTimestamp: Date.now(),
      cacheVersion: 1,
      urlCache: null,
      urlCacheTimestamp: null,
      privacyCache: null,
      privacyCacheTimestamp: null,
    };

    await cache.loadCacheFromSession();

    // Redacted cache stays unrestored: the next read misses and refetches.
    mockGetAll.mockClear();
    await cache.getSettingsWithCache();
    expect(mockGetAll).toHaveBeenCalledTimes(1);
  });

  it('restores url and privacy caches that are still within TTL', async () => {
    const now = Date.now();
    sessionData[SESSION_KEYS.RECORDING_CACHE] = {
      settingsCache: null,
      cacheTimestamp: null,
      cacheVersion: 0,
      urlCache: [['https://a.example', 1700000000000]],
      urlCacheTimestamp: now,
      privacyCache: [['https://b.example', { isPrivate: true, timestamp: now }]],
      privacyCacheTimestamp: now,
    };

    await cache.loadCacheFromSession();

    const urls = await cache.getSavedUrlsWithCache();
    expect(urls.get('https://a.example')).toBe(1700000000000);
    expect(cache.getPrivacyCache()?.has('https://b.example')).toBe(true);
  });

  it('drops url and privacy caches that are past their TTL', async () => {
    const now = Date.now();
    sessionData[SESSION_KEYS.RECORDING_CACHE] = {
      settingsCache: null,
      cacheTimestamp: null,
      cacheVersion: 0,
      urlCache: [['https://a.example', 1]],
      urlCacheTimestamp: now - URL_CACHE_TTL - 1,
      privacyCache: [['https://b.example', { isPrivate: true, timestamp: 1 }]],
      privacyCacheTimestamp: now - PRIVACY_CACHE_TTL - 1,
    };

    await cache.loadCacheFromSession();

    // Expired caches stay unrestored: url refetches, privacy reads null.
    expect(cache.getPrivacyCache()).toBeNull();
    mockGetSavedUrlsWithTimestamps.mockClear();
    await cache.getSavedUrlsWithCache();
    expect(mockGetSavedUrlsWithTimestamps).toHaveBeenCalledTimes(1);
  });

  it('survives a missing session entry without throwing', async () => {
    await expect(cache.loadCacheFromSession()).resolves.toBeUndefined();
    // Nothing restored: the next read misses and refetches.
    mockGetAll.mockClear();
    await cache.getSettingsWithCache();
    expect(mockGetAll).toHaveBeenCalledTimes(1);
  });
});

describe('RecordingCache — URL cache', () => {
  it('serves a second call from cache instead of re-reading storage', async () => {
    await cache.getSavedUrlsWithCache();
    await cache.getSavedUrlsWithCache();

    expect(mockGetSavedUrlsWithTimestamps).toHaveBeenCalledTimes(1);
  });

  it('re-reads storage once the TTL has elapsed', async () => {
    vi.useFakeTimers();
    await cache.getSavedUrlsWithCache();
    expect(mockGetSavedUrlsWithTimestamps).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(URL_CACHE_TTL + 1);
    await cache.getSavedUrlsWithCache();

    expect(mockGetSavedUrlsWithTimestamps).toHaveBeenCalledTimes(2);
  });

  it('re-reads storage after explicit invalidation', async () => {
    await cache.getSavedUrlsWithCache();
    cache.invalidateUrlCache();
    await cache.getSavedUrlsWithCache();

    expect(mockGetSavedUrlsWithTimestamps).toHaveBeenCalledTimes(2);
    // The refetch repopulated: a third read hits without re-reading.
    await cache.getSavedUrlsWithCache();
    expect(mockGetSavedUrlsWithTimestamps).toHaveBeenCalledTimes(2);
  });
});

describe('RecordingCache — privacy cache session fallback', () => {
  it('recovers an entry written before a service worker restart', async () => {
    const url = 'https://example.com/page';
    sessionData['privacyCache_' + url] = { isPrivate: true, timestamp: Date.now() };

    const result = await cache.getPrivacyInfoWithCache(url);

    expect(result?.isPrivate).toBe(true);
    // The recovered entry is promoted into the in-memory cache.
    expect(cache.getPrivacyCache()?.has(url)).toBe(true);
  });

  it('evicts and ignores a session entry past the privacy TTL', async () => {
    const url = 'https://example.com/stale';
    sessionData['privacyCache_' + url] = { isPrivate: true, timestamp: Date.now() - PRIVACY_CACHE_TTL - 1 };

    const result = await cache.getPrivacyInfoWithCache(url);

    expect(result).toBeNull();
    expect(sessionData['privacyCache_' + url]).toBeUndefined();
  });

  it('normalizes the URL so a fragment does not miss the cache', async () => {
    const canonical = 'https://example.com/page';
    cache.setPrivacyCacheEntry(canonical, { isPrivate: true, timestamp: Date.now() } as never);

    const result = await cache.getPrivacyInfoWithCache(canonical + '#section');

    expect(result?.isPrivate).toBe(true);
  });

  it('clears session-stored privacy keys on invalidation', async () => {
    sessionData['privacyCache_https://a.example'] = { isPrivate: true, timestamp: Date.now() };
    sessionData['privacyCache_https://b.example'] = { isPrivate: false, timestamp: Date.now() };
    sessionData['unrelated_key'] = 'keep me';

    await cache.invalidatePrivacyCache();

    expect(sessionData['privacyCache_https://a.example']).toBeUndefined();
    expect(sessionData['privacyCache_https://b.example']).toBeUndefined();
    expect(sessionData['unrelated_key']).toBe('keep me');
    expect(cache.getPrivacyCache()).toBeNull();
  });

  it('returns null when nothing is cached anywhere', async () => {
    const result = await cache.getPrivacyInfoWithCache('https://example.com/unknown');
    expect(result).toBeNull();
  });
});

describe('redactSettingsApiKeys', () => {
  it('empties every configured API key field', () => {
    const redacted = redactSettingsApiKeys({
      geminiApiKey: 'g', providerApiKey: 'p', obsidianApiKey: 'o', keep: 'yes',
    } as never) as Record<string, unknown>;

    expect(redacted.geminiApiKey).toBe('');
    expect(redacted.providerApiKey).toBe('');
    expect(redacted.obsidianApiKey).toBe('');
    expect(redacted.keep).toBe('yes');
  });

  it('returns null for null input', () => {
    expect(redactSettingsApiKeys(null)).toBeNull();
  });
});
