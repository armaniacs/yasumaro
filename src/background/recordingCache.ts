/**
 * RecordingCache — facade that composes 3 typed caches.
 *
 * PBI 05: TTL constants now owned by typed cache modules; this file is a
 * facade that delegates to SettingsCache / UrlCache / PrivacyCache.
 * The single CacheState object is kept as a live view over the 3 caches so
 * existing tests that mutate `getCacheState().cacheVersion` etc remain green
 * (overflow test). Persistence (load/save) still goes through a single
 * SESSION_KEYS.RECORDING_CACHE entry so the microtask saveQueue stays atomic.
 */

import { addLog, LogType } from '../utils/logger.js';
import { getSavedUrlsWithTimestamps } from '../utils/storage/savedUrlRepository.js';
import { settingsRepository, type SettingsReader } from '../utils/storage/SettingsRepository.js';
import { Settings } from '../utils/storage/types.js';
import { API_KEY_FIELDS } from '../utils/storage/settingsMigration.js';
import type { PrivacyInfo } from '../utils/privacyChecker.js';
import { SessionStore, SESSION_KEYS } from './sessionStore.js';
import { redactSettingsApiKeys } from '../utils/storage/storagePort.js';
import { SettingsCache, SETTINGS_CACHE_TTL } from './cache/SettingsCache.js';
import { UrlCache, URL_CACHE_TTL } from './cache/UrlCache.js';
import { PrivacyCache, PRIVACY_CACHE_TTL } from './cache/PrivacyCache.js';

export { SETTINGS_CACHE_TTL, URL_CACHE_TTL, PRIVACY_CACHE_TTL };
// Re-export redact for backward compat (tests import from here)
export { redactSettingsApiKeys } from '../utils/storage/storagePort.js';

// --- Cache state interface (live view over 3 caches) ---

interface CacheState {
  settingsCache: Settings | null;
  cacheTimestamp: number | null;
  cacheVersion: number;
  urlCache: Map<string, number> | null;
  urlCacheTimestamp: number | null;
  privacyCache: Map<string, PrivacyInfo> | null;
  privacyCacheTimestamp: number | null;
}

type PersistedCacheState = {
  settingsCache: Settings | null;
  cacheTimestamp: number | null;
  cacheVersion: number;
  urlCache: [string, number][] | null;
  urlCacheTimestamp: number | null;
  privacyCache: [string, PrivacyInfo][] | null;
  privacyCacheTimestamp: number | null;
};

// --- Store abstraction ---

export interface RecordingCacheStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, options?: { flushImmediately?: boolean }): Promise<void>;
}

export class SessionStoreRecordingCacheStore implements RecordingCacheStore {
  constructor(private readonly sessionStore: SessionStore) {}

  get<T>(key: string): Promise<T | null> {
    return this.sessionStore.get<T>(key);
  }

  set(key: string, value: unknown, options?: { flushImmediately?: boolean }): Promise<void> {
    return this.sessionStore.set(key, value, options);
  }
}

export class InMemoryRecordingCacheStore implements RecordingCacheStore {
  private data = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    return (this.data.get(key) as T | undefined) ?? null;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
  }
}

// --- helpers ---

function hasApiKeys(settings: Settings): boolean {
  const rec = settings as Record<string, unknown>;
  return API_KEY_FIELDS.some((f) => typeof rec[f] === 'string' && (rec[f] as string).length > 0);
}

// --- RecordingCacheInstance facade ---

export class RecordingCacheInstance {
  private readonly settingsCache: SettingsCache;
  private readonly urlCache: UrlCache;
  private readonly privacyCache: PrivacyCache;

  private saveQueueScheduled = false;
  private storageListenerAdded = false;
  private storageListener: ((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) | null = null;

  constructor(
    private readonly store: RecordingCacheStore,
    private readonly repo: SettingsReader = settingsRepository,
  ) {
    this.settingsCache = new SettingsCache(repo);
    this.urlCache = new UrlCache();
    this.privacyCache = new PrivacyCache();
  }

  // =========================================================================
  // Cache state access (backward compat — live view over 3 caches)
  // =========================================================================

  getCacheState(): CacheState {
    const view = {} as CacheState;
    Object.defineProperties(view, {
      settingsCache: {
        get: () => this.settingsCache.getState().cache,
        set: (v: Settings | null) => {
          const s = this.settingsCache.getState();
          this.settingsCache.setState(v, s.timestamp, s.version);
        },
        enumerable: true,
      },
      cacheTimestamp: {
        get: () => this.settingsCache.getState().timestamp,
        set: (v: number | null) => {
          const s = this.settingsCache.getState();
          this.settingsCache.setState(s.cache, v, s.version);
        },
        enumerable: true,
      },
      cacheVersion: {
        get: () => this.settingsCache.getState().version,
        set: (v: number) => {
          const s = this.settingsCache.getState();
          this.settingsCache.setState(s.cache, s.timestamp, v);
        },
        enumerable: true,
      },
      urlCache: {
        get: () => this.urlCache.getState().cache,
        set: (v: Map<string, number> | null) => {
          const s = this.urlCache.getState();
          this.urlCache.setState(v, s.timestamp);
        },
        enumerable: true,
      },
      urlCacheTimestamp: {
        get: () => this.urlCache.getState().timestamp,
        set: (v: number | null) => {
          const s = this.urlCache.getState();
          this.urlCache.setState(s.cache, v);
        },
        enumerable: true,
      },
      privacyCache: {
        get: () => this.privacyCache.getState().cache,
        set: (v: Map<string, PrivacyInfo> | null) => {
          const s = this.privacyCache.getState();
          this.privacyCache.setState(v, s.timestamp);
        },
        enumerable: true,
      },
      privacyCacheTimestamp: {
        get: () => this.privacyCache.getState().timestamp,
        set: (v: number | null) => {
          const s = this.privacyCache.getState();
          this.privacyCache.setState(s.cache, v);
        },
        enumerable: true,
      },
    });
    return view;
  }

  resetCacheState(): void {
    this.settingsCache.setState(null, null, 0);
    this.urlCache.setState(null, null);
    this.privacyCache.setState(null, null);
  }

  // =========================================================================
  // Privacy cache accessors (used by headerDetector, tabEventHandlers, service-worker)
  // =========================================================================

  getPrivacyCache(): Map<string, PrivacyInfo> | null {
    return this.privacyCache.get();
  }

  setPrivacyCacheEntry(url: string, info: PrivacyInfo): void {
    this.privacyCache.setEntry(url, info);
  }

  getPrivacyCacheSize(): number {
    return this.privacyCache.size();
  }

  isPrivacyCacheInitialized(): boolean {
    return this.privacyCache.isInitialized();
  }

  // =========================================================================
  // Cross-context invalidation: facade owns the single chrome.storage.onChanged
  // listener and broadcasts to the typed caches. Dispose deregisters it.
  // =========================================================================

  ensureStorageListener(): void {
    if (this.storageListenerAdded) return;
    this.storageListenerAdded = true;
    try {
      const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area !== 'local') return;
        if ('settings' in changes) {
          this.invalidateSettingsCache();
        }
      };
      this.storageListener = handler;
      chrome.storage.onChanged.addListener(handler);
    } catch {
      // chrome.storage unavailable in tests
    }
  }

  dispose(): void {
    if (this.storageListener && typeof chrome !== 'undefined' && chrome.storage?.onChanged?.removeListener) {
      try {
        chrome.storage.onChanged.removeListener(this.storageListener);
      } catch {
        // ignore
      }
    }
    this.storageListener = null;
    this.storageListenerAdded = false;
  }

  // =========================================================================
  // Settings cache — delegates TTL/stale check to SettingsCache
  // =========================================================================

  async getSettingsWithCache(): Promise<Settings> {
    const now = Date.now();
    if (!this.settingsCache.isStale(now)) {
      const state = this.settingsCache.getState();
      const age = now - (state.timestamp ?? now);
      addLog(LogType.DEBUG, 'Settings cache hit', { age: age + 'ms' });
      return state.cache as Settings;
    }
    return this.fetchAndCacheSettings(now);
  }

  private async fetchAndCacheSettings(now: number): Promise<Settings> {
    const settings = await this.repo.getAll();
    const state = this.settingsCache.getState();
    this.settingsCache.setState(settings, now, state.version + 1);
    addLog(LogType.DEBUG, 'Settings cache updated', { cacheVersion: state.version + 1 });
    this.scheduleCacheSave();
    return settings;
  }

  invalidateSettingsCache(): void {
    addLog(LogType.DEBUG, 'Settings cache invalidated');
    this.settingsCache.invalidate();
    this.scheduleCacheSave();
  }

  // =========================================================================
  // URL cache — delegates TTL/stale check to UrlCache
  // =========================================================================

  async getSavedUrlsWithCache(): Promise<Map<string, number>> {
    const now = Date.now();
    if (!this.urlCache.isStale(now)) {
      const state = this.urlCache.getState();
      const age = now - (state.timestamp ?? now);
      addLog(LogType.DEBUG, 'URL cache hit', { count: state.cache!.size, age: age + 'ms' });
      return state.cache as Map<string, number>;
    }

    const urlMap = await getSavedUrlsWithTimestamps();
    this.urlCache.setState(new Map(urlMap), now);
    addLog(LogType.DEBUG, 'URL cache updated', { count: urlMap.size });
    this.scheduleCacheSave();
    return urlMap;
  }

  invalidateUrlCache(): void {
    addLog(LogType.DEBUG, 'URL cache invalidated');
    this.urlCache.invalidate();
    this.scheduleCacheSave();
  }

  // =========================================================================
  // Privacy cache — delegates session fallback to PrivacyCache
  // =========================================================================

  async getPrivacyInfoWithCache(url: string): Promise<PrivacyInfo | null> {
    return this.privacyCache.getWithFallback(url);
  }

  async invalidatePrivacyCache(): Promise<void> {
    addLog(LogType.DEBUG, 'Privacy cache invalidated');
    this.privacyCache.invalidate();
    this.scheduleCacheSave();
    await this.privacyCache.clearSession();
  }

  // =========================================================================
  // Store persistence
  // =========================================================================

  async loadCacheFromSession(): Promise<void> {
    try {
      const saved = await this.store.get<PersistedCacheState>(SESSION_KEYS.RECORDING_CACHE);
      if (!saved) return;
      const now = Date.now();

      if (
        saved.settingsCache &&
        saved.cacheTimestamp &&
        now - saved.cacheTimestamp < SETTINGS_CACHE_TTL &&
        hasApiKeys(saved.settingsCache)
      ) {
        this.settingsCache.setState(saved.settingsCache, saved.cacheTimestamp, saved.cacheVersion);
      }
      if (saved.urlCache && saved.urlCacheTimestamp && now - saved.urlCacheTimestamp < URL_CACHE_TTL) {
        this.urlCache.setState(SessionStore.entriesToMap(saved.urlCache), saved.urlCacheTimestamp);
      }
      if (saved.privacyCache && saved.privacyCacheTimestamp && now - saved.privacyCacheTimestamp < PRIVACY_CACHE_TTL) {
        this.privacyCache.setState(SessionStore.entriesToMap(saved.privacyCache), saved.privacyCacheTimestamp);
      }
    } catch {
      // store unavailable
    }
  }

  scheduleCacheSave(): void {
    if (this.saveQueueScheduled) return;
    this.saveQueueScheduled = true;
    queueMicrotask(async () => {
      this.saveQueueScheduled = false;
      try {
        await this.saveCacheToSession();
      } catch (err) {
        console.warn('[RecordingCache] Failed to persist cache to session storage:', err);
      }
    });
  }

  private async saveCacheToSession(): Promise<void> {
    const sState = this.settingsCache.getState();
    const uState = this.urlCache.getState();
    const pState = this.privacyCache.getState();
    const payload: PersistedCacheState = {
      // VULN-014: persist a redacted copy — never write decrypted API keys.
      // Redaction is owned by StoragePort decorator (see storagePort.ts);
      // this call uses the shared helper so cache modules stay unaware.
      settingsCache: redactSettingsApiKeys(sState.cache),
      cacheTimestamp: sState.timestamp,
      cacheVersion: sState.version,
      urlCache: uState.cache ? SessionStore.mapToEntries(uState.cache) : null,
      urlCacheTimestamp: uState.timestamp,
      privacyCache: pState.cache ? SessionStore.mapToEntries(pState.cache) : null,
      privacyCacheTimestamp: pState.timestamp,
    };
    await this.store.set(SESSION_KEYS.RECORDING_CACHE, payload, { flushImmediately: true });
  }
}

// WHY: PBI-03 removed the module-level static RecordingCache facade. All
// callers now receive a RecordingCacheInstance via DI, so tests and production
// use the same instance-based API and there is no hidden global state.
