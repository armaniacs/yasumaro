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
  API_KEY_FIELDS: ['geminiApiKey', 'providerApiKey', 'obsidianApiKey'],
}));

import {
  RecordingCache,
  redactSettingsApiKeys,
  SETTINGS_CACHE_TTL,
  URL_CACHE_TTL,
  PRIVACY_CACHE_TTL,
} from '../recordingCache.js';
import { SESSION_KEYS } from '../sessionStore.js';

/** In-memory stand-in for chrome.storage.session. */
let sessionData: Record<string, unknown> = {};

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

beforeEach(() => {
  sessionData = {};
  vi.clearAllMocks();
  installChromeSessionMock();
  RecordingCache.resetCacheState();
  mockGetSettings.mockResolvedValue({ geminiApiKey: 'secret-key', someFlag: true });
  mockGetSavedUrlsWithTimestamps.mockResolvedValue(new Map([['https://example.com', 1700000000000]]));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RecordingCache — session storage persistence', () => {
  it('VULN-014: never writes decrypted API keys to session storage', async () => {
    await RecordingCache.getSettingsWithCache();
    await flushSave();

    const persisted = sessionData[SESSION_KEYS.RECORDING_CACHE] as
      { settingsCache: Record<string, unknown> } | undefined;

    expect(persisted).toBeDefined();
    // The in-memory cache keeps the real key for API calls...
    expect(RecordingCache.getCacheState().settingsCache?.geminiApiKey).toBe('secret-key');
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

    await RecordingCache.loadCacheFromSession();

    const state = RecordingCache.getCacheState();
    expect(state.settingsCache?.someFlag).toBe(false);
    expect(state.cacheVersion).toBe(7);
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

    await RecordingCache.loadCacheFromSession();

    expect(RecordingCache.getCacheState().settingsCache).toBeNull();
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

    await RecordingCache.loadCacheFromSession();

    expect(RecordingCache.getCacheState().settingsCache).toBeNull();
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

    await RecordingCache.loadCacheFromSession();

    const state = RecordingCache.getCacheState();
    expect(state.urlCache?.get('https://a.example')).toBe(1700000000000);
    expect(state.privacyCache?.has('https://b.example')).toBe(true);
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

    await RecordingCache.loadCacheFromSession();

    const state = RecordingCache.getCacheState();
    expect(state.urlCache).toBeNull();
    expect(state.privacyCache).toBeNull();
  });

  it('survives a missing session entry without throwing', async () => {
    await expect(RecordingCache.loadCacheFromSession()).resolves.toBeUndefined();
    expect(RecordingCache.getCacheState().settingsCache).toBeNull();
  });
});

describe('RecordingCache — URL cache', () => {
  it('serves a second call from cache instead of re-reading storage', async () => {
    await RecordingCache.getSavedUrlsWithCache();
    await RecordingCache.getSavedUrlsWithCache();

    expect(mockGetSavedUrlsWithTimestamps).toHaveBeenCalledTimes(1);
  });

  it('re-reads storage once the TTL has elapsed', async () => {
    vi.useFakeTimers();
    await RecordingCache.getSavedUrlsWithCache();
    expect(mockGetSavedUrlsWithTimestamps).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(URL_CACHE_TTL + 1);
    await RecordingCache.getSavedUrlsWithCache();

    expect(mockGetSavedUrlsWithTimestamps).toHaveBeenCalledTimes(2);
  });

  it('re-reads storage after explicit invalidation', async () => {
    await RecordingCache.getSavedUrlsWithCache();
    RecordingCache.invalidateUrlCache();
    await RecordingCache.getSavedUrlsWithCache();

    expect(mockGetSavedUrlsWithTimestamps).toHaveBeenCalledTimes(2);
    expect(RecordingCache.getCacheState().urlCacheTimestamp).not.toBeNull();
  });
});

describe('RecordingCache — privacy cache session fallback', () => {
  it('recovers an entry written before a service worker restart', async () => {
    const url = 'https://example.com/page';
    sessionData['privacyCache_' + url] = { isPrivate: true, timestamp: Date.now() };

    const result = await RecordingCache.getPrivacyInfoWithCache(url);

    expect(result?.isPrivate).toBe(true);
    // The recovered entry is promoted into the in-memory cache.
    expect(RecordingCache.getPrivacyCache()?.has(url)).toBe(true);
  });

  it('evicts and ignores a session entry past the privacy TTL', async () => {
    const url = 'https://example.com/stale';
    sessionData['privacyCache_' + url] = { isPrivate: true, timestamp: Date.now() - PRIVACY_CACHE_TTL - 1 };

    const result = await RecordingCache.getPrivacyInfoWithCache(url);

    expect(result).toBeNull();
    expect(sessionData['privacyCache_' + url]).toBeUndefined();
  });

  it('normalizes the URL so a fragment does not miss the cache', async () => {
    const canonical = 'https://example.com/page';
    RecordingCache.setPrivacyCacheEntry(canonical, { isPrivate: true, timestamp: Date.now() } as never);

    const result = await RecordingCache.getPrivacyInfoWithCache(canonical + '#section');

    expect(result?.isPrivate).toBe(true);
  });

  it('clears session-stored privacy keys on invalidation', async () => {
    sessionData['privacyCache_https://a.example'] = { isPrivate: true, timestamp: Date.now() };
    sessionData['privacyCache_https://b.example'] = { isPrivate: false, timestamp: Date.now() };
    sessionData['unrelated_key'] = 'keep me';

    await RecordingCache.invalidatePrivacyCache();

    expect(sessionData['privacyCache_https://a.example']).toBeUndefined();
    expect(sessionData['privacyCache_https://b.example']).toBeUndefined();
    expect(sessionData['unrelated_key']).toBe('keep me');
    expect(RecordingCache.getPrivacyCache()).toBeNull();
  });

  it('returns null when nothing is cached anywhere', async () => {
    const result = await RecordingCache.getPrivacyInfoWithCache('https://example.com/unknown');
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
