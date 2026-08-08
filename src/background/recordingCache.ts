/**
 * RecordingCache
 * settings/URL/privacy の3種のキャッシュ管理を担当するモジュール。
 *
 * RecordingLogic から抽出（PBI-2026-08-08-01）。
 * headerDetector / tabEventHandlers / service-worker から直接アクセスされるため、
 * accessor メソッドでアクセスを制御する。
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

// --- RecordingCache class ---

export class RecordingCache {
  // Cache state (private static — accessed only through accessor methods)
  private static cacheState: CacheState = {
    settingsCache: null,
    cacheTimestamp: null,
    cacheVersion: 0,
    urlCache: null,
    urlCacheTimestamp: null,
    privacyCache: null,
    privacyCacheTimestamp: null,
  };

  private static sessionStore: SessionStore = new SessionStore();
  private static saveQueueScheduled = false;

  // =========================================================================
  // Cache state access (for backward compatibility and testing)
  // =========================================================================

  /**
   * Get a reference to the internal cache state (for backward compatibility).
   * Prefer using specific accessor methods instead of accessing cacheState directly.
   */
  static getCacheState(): CacheState {
    return RecordingCache.cacheState;
  }

  /**
   * Reset cache state (for testing).
   */
  static resetCacheState(): void {
    RecordingCache.cacheState = {
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

  /**
   * Get the privacy cache map (for read access by tabEventHandlers, service-worker).
   */
  static getPrivacyCache(): Map<string, PrivacyInfo> | null {
    return RecordingCache.cacheState.privacyCache;
  }

  /**
   * Set a privacy info entry in the cache (used by HeaderDetector).
   * Initializes the cache map if it doesn't exist.
   */
  static setPrivacyCacheEntry(url: string, info: PrivacyInfo): void {
    if (!RecordingCache.cacheState.privacyCache) {
      RecordingCache.cacheState.privacyCache = new Map();
      RecordingCache.cacheState.privacyCacheTimestamp = Date.now();
    }
    RecordingCache.cacheState.privacyCache.set(url, info);
  }

  /**
   * Get the privacy cache size (used by HeaderDetector for logging).
   */
  static getPrivacyCacheSize(): number {
    return RecordingCache.cacheState.privacyCache?.size ?? 0;
  }

  /**
   * Check if the privacy cache is initialized.
   */
  static isPrivacyCacheInitialized(): boolean {
    return RecordingCache.cacheState.privacyCache !== null;
  }

  // =========================================================================
  // Settings cache
  // =========================================================================

  /**
   * Get settings with cache (TTL-based).
   */
  static async getSettingsWithCache(): Promise<Settings> {
    const now = Date.now();
    const cs = RecordingCache.cacheState;

    if (cs.settingsCache && cs.cacheTimestamp) {
      const age = now - cs.cacheTimestamp;
      if (age < SETTINGS_CACHE_TTL) {
        addLog(LogType.DEBUG, 'Settings cache hit', { age: age + 'ms' });
        return cs.settingsCache;
      }
    }

    return RecordingCache.fetchAndCacheSettings(now);
  }

  private static async fetchAndCacheSettings(now: number): Promise<Settings> {
    const settings = await getSettings();
    const cs = RecordingCache.cacheState;

    cs.settingsCache = settings;
    cs.cacheTimestamp = now;
    cs.cacheVersion++;

    addLog(LogType.DEBUG, 'Settings cache updated', { cacheVersion: cs.cacheVersion });
    RecordingCache.scheduleCacheSave();

    return settings;
  }

  /**
   * Invalidate settings cache.
   */
  static invalidateSettingsCache(): void {
    addLog(LogType.DEBUG, 'Settings cache invalidated');
    const cs = RecordingCache.cacheState;
    cs.settingsCache = null;
    cs.cacheTimestamp = null;
    cs.cacheVersion++;
    RecordingCache.scheduleCacheSave();
  }

  // =========================================================================
  // URL cache
  // =========================================================================

  /**
   * Get saved URLs with cache (TTL-based).
   */
  static async getSavedUrlsWithCache(): Promise<Map<string, number>> {
    const now = Date.now();
    const cs = RecordingCache.cacheState;

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
    RecordingCache.scheduleCacheSave();

    return urlMap;
  }

  /**
   * Invalidate URL cache.
   */
  static invalidateUrlCache(): void {
    addLog(LogType.DEBUG, 'URL cache invalidated');
    const cs = RecordingCache.cacheState;
    cs.urlCache = null;
    cs.urlCacheTimestamp = null;
    RecordingCache.scheduleCacheSave();
  }

  // =========================================================================
  // Privacy cache (get with session storage fallback)
  // =========================================================================

  /**
   * Get privacy info with cache (TTL-based, session storage fallback).
   */
  static async getPrivacyInfoWithCache(url: string): Promise<PrivacyInfo | null> {
    const now = Date.now();
    const normalizedUrl = normalizeUrlForCache(url);
    const cs = RecordingCache.cacheState;

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

  /**
   * Invalidate privacy cache (in-memory + session storage keys).
   */
  static async invalidatePrivacyCache(): Promise<void> {
    addLog(LogType.DEBUG, 'Privacy cache invalidated');
    const cs = RecordingCache.cacheState;
    cs.privacyCache = null;
    cs.privacyCacheTimestamp = null;
    RecordingCache.scheduleCacheSave();

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
  // Session storage persistence
  // =========================================================================

  /**
   * Restore cache state from session storage.
   */
  static async loadCacheFromSession(): Promise<void> {
    try {
      const saved = await RecordingCache.sessionStore.get<{
        settingsCache: Settings | null;
        cacheTimestamp: number | null;
        cacheVersion: number;
        urlCache: [string, number][] | null;
        urlCacheTimestamp: number | null;
        privacyCache: [string, PrivacyInfo][] | null;
        privacyCacheTimestamp: number | null;
      }>(SESSION_KEYS.RECORDING_CACHE);
      if (!saved) return;
      const now = Date.now();
      const cs = RecordingCache.cacheState;

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
      // session store unavailable
    }
  }

  /**
   * Schedule a debounced cache save to session storage.
   */
  static scheduleCacheSave(): void {
    if (RecordingCache.saveQueueScheduled) return;
    RecordingCache.saveQueueScheduled = true;
    queueMicrotask(async () => {
      RecordingCache.saveQueueScheduled = false;
      try {
        await RecordingCache.saveCacheToSession();
      } catch (err) {
        console.warn('[RecordingCache] Failed to persist cache to session storage:', err);
      }
    });
  }

  private static async saveCacheToSession(): Promise<void> {
    const cs = RecordingCache.cacheState;
    await RecordingCache.sessionStore.set(SESSION_KEYS.RECORDING_CACHE, {
      // VULN-014: persist a redacted copy — never write decrypted API keys
      settingsCache: redactSettingsApiKeys(cs.settingsCache),
      cacheTimestamp: cs.cacheTimestamp,
      cacheVersion: cs.cacheVersion,
      urlCache: cs.urlCache ? SessionStore.mapToEntries(cs.urlCache) : null,
      urlCacheTimestamp: cs.urlCacheTimestamp,
      privacyCache: cs.privacyCache ? SessionStore.mapToEntries(cs.privacyCache) : null,
      privacyCacheTimestamp: cs.privacyCacheTimestamp,
    }, { flushImmediately: true });
  }
}
