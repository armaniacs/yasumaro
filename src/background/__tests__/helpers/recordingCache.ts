/**
 * Test-only helper that exposes the old static RecordingCache API over a
 * shared RecordingCacheInstance.
 *
 * PBI-03 removed the production static facade so production code always
 * receives a cache via DI. Tests that historically relied on the global
 * facade can import this helper instead, keeping the same call signature
 * without reintroducing global state into the source tree.
 */
import {
  RecordingCacheInstance,
  InMemoryRecordingCacheStore,
  redactSettingsApiKeys,
  SETTINGS_CACHE_TTL,
  URL_CACHE_TTL,
  PRIVACY_CACHE_TTL,
} from '../../recordingCache.js';

const sharedStore = new InMemoryRecordingCacheStore();
const sharedCache = new RecordingCacheInstance(sharedStore);

export const RecordingCache = {
  getCacheState: () => sharedCache.getCacheState(),
  resetCacheState: () => sharedCache.resetCacheState(),
  getPrivacyCache: () => sharedCache.getPrivacyCache(),
  setPrivacyCacheEntry: (url: string, info: import('../../utils/privacyChecker.js').PrivacyInfo) => sharedCache.setPrivacyCacheEntry(url, info),
  getPrivacyCacheSize: () => sharedCache.getPrivacyCacheSize(),
  isPrivacyCacheInitialized: () => sharedCache.isPrivacyCacheInitialized(),
  getSettingsWithCache: () => sharedCache.getSettingsWithCache(),
  invalidateSettingsCache: () => sharedCache.invalidateSettingsCache(),
  getSavedUrlsWithCache: () => sharedCache.getSavedUrlsWithCache(),
  invalidateUrlCache: () => sharedCache.invalidateUrlCache(),
  getPrivacyInfoWithCache: (url: string) => sharedCache.getPrivacyInfoWithCache(url),
  invalidatePrivacyCache: () => sharedCache.invalidatePrivacyCache(),
  loadCacheFromSession: () => sharedCache.loadCacheFromSession(),
  scheduleCacheSave: () => sharedCache.scheduleCacheSave(),
};

export { RecordingCacheInstance, InMemoryRecordingCacheStore, redactSettingsApiKeys, SETTINGS_CACHE_TTL, URL_CACHE_TTL, PRIVACY_CACHE_TTL };
