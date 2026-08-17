/**
 * RecordingCache
 * settings/URL/privacy の3種のキャッシュ管理を担当するモジュール。
 *
 * headerDetector / tabEventHandlers / service-worker から直接アクセスされるため、
 * accessor メソッドでアクセスを制御する。
 *
 * インスタンス化されたクラスとして実装され、store（永続化バックエンド）を
 * コンストラクタで注入する。既存呼び出し元との互換性のため、モジュールレベル
 * の defaultRecordingCache を静的メソッド経由で公開する。
 */

import { addLog, LogType } from '../utils/logger.js';
import { getSettings, getSavedUrlsWithTimestamps, Settings } from '../utils/storage.js';
import { API_KEY_FIELDS } from '../utils/storage/settingsStore.js';
import type { PrivacyInfo } from '../utils/privacyChecker.js';
import { isPrivacyInfo } from '../utils/privacyChecker.js';
import { SessionStore, SESSION_KEYS } from './sessionStore.js';

// --- TTL constants ---

/** Settings cache TTL: 30 seconds */
export const SETTINGS_CACHE_TTL = 30 * 1000;

/** URL cache TTL: 60 seconds */
export const URL_CACHE_TTL = 60 * 1000;

/** Privacy cache TTL: 5 minutes */
export const PRIVACY_CACHE_TTL = 5 * 60 * 1000;

// --- Cache state interface ---

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

/**
 * Minimal persistence interface RecordingCache depends on. Backed by
 * SessionStore in production; tests inject an in-memory implementation to
 * avoid touching chrome.storage.session and to get per-test isolation.
 */
export interface RecordingCacheStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, options?: { flushImmediately?: boolean }): Promise<void>;
}

/** Production store: wraps a SessionStore instance. */
export class SessionStoreRecordingCacheStore implements RecordingCacheStore {
  constructor(private readonly sessionStore: SessionStore) {}

  get<T>(key: string): Promise<T | null> {
    return this.sessionStore.get<T>(key);
  }

  set(key: string, value: unknown, options?: { flushImmediately?: boolean }): Promise<void> {
    return this.sessionStore.set(key, value, options);
  }
}

/** In-memory store for tests: no chrome.storage dependency, per-instance isolation. */
export class InMemoryRecordingCacheStore implements RecordingCacheStore {
  private data = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    return (this.data.get(key) as T | undefined) ?? null;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
  }
}

// --- VULN-014 helpers ---

/**
 * VULN-014 (CWE-312): return a shallow copy of settings with every API-key
 * field emptied. The in-memory cache keeps the real (decrypted) keys for actual
 * API calls; the session-storage mirror must not persist them.
 */
export function redactSettingsApiKeys(settings: Settings | null): Settings | null {
  if (!settings) return null;
  const copy = { ...settings } as Record<string, unknown>;
  for (const field of API_KEY_FIELDS) {
    if (field in copy) copy[field] = '';
  }
  return copy as Settings;
}

/**
 * VULN-014: whether the cached settings carry at least one populated API key.
 */
function hasApiKeys(settings: Settings): boolean {
  const rec = settings as Record<string, unknown>;
  return API_KEY_FIELDS.some(f => typeof rec[f] === 'string' && (rec[f] as string).length > 0);
}

// --- URL normalization ---

/**
 * Normalize URL for cache key consistency.
 * Strips fragment and trailing slash (matching HeaderDetector logic).
 */
function normalizeUrlForCache(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    let normalized = parsed.toString();
    if (normalized.endsWith('/') && parsed.pathname !== '/') {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    return url;
  }
}

// --- RecordingCacheInstance class ---

/**
 * Instance-based cache. Each instance owns its own cache state and store,
 * so tests can create independent instances instead of sharing global state.
 */
export class RecordingCacheInstance {
  private cacheState: CacheState = {
    settingsCache: null,
    cacheTimestamp: null,
    cacheVersion: 0,
    urlCache: null,
    urlCacheTimestamp: null,
    privacyCache: null,
    privacyCacheTimestamp: null,
  };

  private saveQueueScheduled = false;

  constructor(private readonly store: RecordingCacheStore) {}

  // =========================================================================
  // Cache state access (for backward compatibility and testing)
  // =========================================================================

  getCacheState(): CacheState {
    return this.cacheState;
  }

  resetCacheState(): void {
    this.cacheState = {
      settingsCache: null,
      cacheTimestamp: null,
      cacheVersion: 0,
      urlCache: null,
      urlCacheTimestamp: null,
      privacyCache: null,
      privacyCacheTimestamp: null,
    };
  }

  // =========================================================================
  // Privacy cache accessors (used by headerDetector, tabEventHandlers, service-worker)
  // =========================================================================

  getPrivacyCache(): Map<string, PrivacyInfo> | null {
    return this.cacheState.privacyCache;
  }

  setPrivacyCacheEntry(url: string, info: PrivacyInfo): void {
    if (!this.cacheState.privacyCache) {
      this.cacheState.privacyCache = new Map();
      this.cacheState.privacyCacheTimestamp = Date.now();
    }
    this.cacheState.privacyCache.set(url, info);
  }

  getPrivacyCacheSize(): number {
    return this.cacheState.privacyCache?.size ?? 0;
  }

  isPrivacyCacheInitialized(): boolean {
    return this.cacheState.privacyCache !== null;
  }

  // =========================================================================
  // Settings cache
  // =========================================================================

  async getSettingsWithCache(): Promise<Settings> {
    const now = Date.now();
    const cs = this.cacheState;

    if (cs.settingsCache && cs.cacheTimestamp) {
      const age = now - cs.cacheTimestamp;
      if (age < SETTINGS_CACHE_TTL) {
        addLog(LogType.DEBUG, 'Settings cache hit', { age: age + 'ms' });
        return cs.settingsCache;
      }
    }

    return this.fetchAndCacheSettings(now);
  }

  private async fetchAndCacheSettings(now: number): Promise<Settings> {
    const settings = await getSettings();
    const cs = this.cacheState;

    cs.settingsCache = settings;
    cs.cacheTimestamp = now;
    cs.cacheVersion++;

    addLog(LogType.DEBUG, 'Settings cache updated', { cacheVersion: cs.cacheVersion });
    this.scheduleCacheSave();

    return settings;
  }

  invalidateSettingsCache(): void {
    addLog(LogType.DEBUG, 'Settings cache invalidated');
    const cs = this.cacheState;
    cs.settingsCache = null;
    cs.cacheTimestamp = null;
    cs.cacheVersion++;
    this.scheduleCacheSave();
  }

  // =========================================================================
  // URL cache
  // =========================================================================

  async getSavedUrlsWithCache(): Promise<Map<string, number>> {
    const now = Date.now();
    const cs = this.cacheState;

    if (cs.urlCache && cs.urlCacheTimestamp) {
      const age = now - cs.urlCacheTimestamp;
      if (age < URL_CACHE_TTL) {
        addLog(LogType.DEBUG, 'URL cache hit', { count: cs.urlCache.size, age: age + 'ms' });
        return cs.urlCache;
      }
    }

    const urlMap = await getSavedUrlsWithTimestamps();
    cs.urlCache = new Map(urlMap);
    cs.urlCacheTimestamp = now;

    addLog(LogType.DEBUG, 'URL cache updated', { count: urlMap.size });
    this.scheduleCacheSave();

    return urlMap;
  }

  invalidateUrlCache(): void {
    addLog(LogType.DEBUG, 'URL cache invalidated');
    const cs = this.cacheState;
    cs.urlCache = null;
    cs.urlCacheTimestamp = null;
    this.scheduleCacheSave();
  }

  // =========================================================================
  // Privacy cache (get with session storage fallback)
  // =========================================================================

  async getPrivacyInfoWithCache(url: string): Promise<PrivacyInfo | null> {
    const now = Date.now();
    const normalizedUrl = normalizeUrlForCache(url);
    const cs = this.cacheState;

    if (cs.privacyCache) {
      const cached = cs.privacyCache.get(normalizedUrl);
      if (cached && (now - cached.timestamp) < PRIVACY_CACHE_TTL) {
        addLog(LogType.DEBUG, 'Privacy cache hit', { url });
        return cached;
      }
    }

    // Session storage fallback (SW restart recovery)
    if (chrome.storage.session) {
      try {
        const sessionKey = 'privacyCache_' + normalizedUrl;
        const result = await chrome.storage.session.get(sessionKey);
        const cached = isPrivacyInfo(result[sessionKey]) ? result[sessionKey] : undefined;
        if (cached) {
          if ((now - cached.timestamp) >= PRIVACY_CACHE_TTL) {
            await chrome.storage.session.remove(sessionKey);
            addLog(LogType.DEBUG, 'Privacy cache session entry expired, evicted', { url });
          } else {
            if (!cs.privacyCache) {
              cs.privacyCache = new Map();
              cs.privacyCacheTimestamp = Date.now();
            }
            cs.privacyCache.set(normalizedUrl, cached);
            addLog(LogType.DEBUG, 'Privacy cache restored from session storage', { url });
            return cached;
          }
        }
      } catch {
        // session storage errors are non-fatal
      }
    }

    addLog(LogType.DEBUG, 'Privacy check skipped: no header data', { url });
    return null;
  }

  async invalidatePrivacyCache(): Promise<void> {
    addLog(LogType.DEBUG, 'Privacy cache invalidated');
    const cs = this.cacheState;
    cs.privacyCache = null;
    cs.privacyCacheTimestamp = null;
    this.scheduleCacheSave();

    if (chrome.storage.session) {
      try {
        const all = await chrome.storage.session.get(null);
        const privacyKeys = Object.keys(all).filter((key) => key.startsWith('privacyCache_'));
        if (privacyKeys.length > 0) {
          await chrome.storage.session.remove(privacyKeys);
        }
      } catch {
        // session storage errors are non-fatal
      }
    }
  }

  // =========================================================================
  // Store persistence
  // =========================================================================

  async loadCacheFromSession(): Promise<void> {
    try {
      const saved = await this.store.get<PersistedCacheState>(SESSION_KEYS.RECORDING_CACHE);
      if (!saved) return;
      const now = Date.now();
      const cs = this.cacheState;

      if (saved.settingsCache && saved.cacheTimestamp && (now - saved.cacheTimestamp) < SETTINGS_CACHE_TTL
        && hasApiKeys(saved.settingsCache)) {
        cs.settingsCache = saved.settingsCache;
        cs.cacheTimestamp = saved.cacheTimestamp;
        cs.cacheVersion = saved.cacheVersion;
      }
      if (saved.urlCache && saved.urlCacheTimestamp && (now - saved.urlCacheTimestamp) < URL_CACHE_TTL) {
        cs.urlCache = SessionStore.entriesToMap(saved.urlCache);
        cs.urlCacheTimestamp = saved.urlCacheTimestamp;
      }
      if (saved.privacyCache && saved.privacyCacheTimestamp && (now - saved.privacyCacheTimestamp) < PRIVACY_CACHE_TTL) {
        cs.privacyCache = SessionStore.entriesToMap(saved.privacyCache);
        cs.privacyCacheTimestamp = saved.privacyCacheTimestamp;
      }
    } catch {
      // store unavailable
    }
  }

  /**
   * Schedule a debounced cache save to the store.
   */
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
    const cs = this.cacheState;
    const payload: PersistedCacheState = {
      // VULN-014: persist a redacted copy — never write decrypted API keys
      settingsCache: redactSettingsApiKeys(cs.settingsCache),
      cacheTimestamp: cs.cacheTimestamp,
      cacheVersion: cs.cacheVersion,
      urlCache: cs.urlCache ? SessionStore.mapToEntries(cs.urlCache) : null,
      urlCacheTimestamp: cs.urlCacheTimestamp,
      privacyCache: cs.privacyCache ? SessionStore.mapToEntries(cs.privacyCache) : null,
      privacyCacheTimestamp: cs.privacyCacheTimestamp,
    };
    await this.store.set(SESSION_KEYS.RECORDING_CACHE, payload, { flushImmediately: true });
  }
}

// --- Default production instance + static compatibility wrapper ---

const defaultRecordingCache = new RecordingCacheInstance(
  new SessionStoreRecordingCacheStore(new SessionStore())
);

/**
 * Static-method facade over defaultRecordingCache, kept so the ~14 existing
 * call sites (headerDetector, tabEventHandlers, service-worker,
 * createBackgroundServices, RecordingPipeline, lifecycleHandlers) work
 * unchanged. New code should prefer constructing a RecordingCacheInstance
 * directly (or receiving one via DI) instead of adding new static callers.
 */
export class RecordingCache {
  static getCacheState(): CacheState {
    return defaultRecordingCache.getCacheState();
  }

  static resetCacheState(): void {
    defaultRecordingCache.resetCacheState();
  }

  static getPrivacyCache(): Map<string, PrivacyInfo> | null {
    return defaultRecordingCache.getPrivacyCache();
  }

  static setPrivacyCacheEntry(url: string, info: PrivacyInfo): void {
    defaultRecordingCache.setPrivacyCacheEntry(url, info);
  }

  static getPrivacyCacheSize(): number {
    return defaultRecordingCache.getPrivacyCacheSize();
  }

  static isPrivacyCacheInitialized(): boolean {
    return defaultRecordingCache.isPrivacyCacheInitialized();
  }

  static async getSettingsWithCache(): Promise<Settings> {
    return defaultRecordingCache.getSettingsWithCache();
  }

  static invalidateSettingsCache(): void {
    defaultRecordingCache.invalidateSettingsCache();
  }

  static async getSavedUrlsWithCache(): Promise<Map<string, number>> {
    return defaultRecordingCache.getSavedUrlsWithCache();
  }

  static invalidateUrlCache(): void {
    defaultRecordingCache.invalidateUrlCache();
  }

  static async getPrivacyInfoWithCache(url: string): Promise<PrivacyInfo | null> {
    return defaultRecordingCache.getPrivacyInfoWithCache(url);
  }

  static async invalidatePrivacyCache(): Promise<void> {
    return defaultRecordingCache.invalidatePrivacyCache();
  }

  static async loadCacheFromSession(): Promise<void> {
    return defaultRecordingCache.loadCacheFromSession();
  }

  static scheduleCacheSave(): void {
    defaultRecordingCache.scheduleCacheSave();
  }
}
