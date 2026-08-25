// @layer 1-循環 — Infrastructure (circular with trustDb, see ADR 2026-08-20)
/**
 * settingsStore.legacy.ts — @deprecated static wrapper around SettingsRepository.
 *
 * This module exists for backward compatibility while production code migrates
 * to SettingsRepository directly. Tests that mock this module continue to work
 * because the wrapper is replaced by the mock before execution.
 *
 * New code must import from SettingsRepository.ts instead.
 */

import { SettingsRepository, ChromeStorageAdapter } from './SettingsRepository.js';
import { StorageKeys, type Settings } from './types.js';
import { buildAllowedUrls, computeUrlsHash } from './urlWhitelist.js';

const repo = new SettingsRepository(new ChromeStorageAdapter());

let cachedSettings: { data: Settings | null; timestamp: number } | null = null;
const SETTINGS_CACHE_TTL = 1000;

export async function getSettings(): Promise<Settings> {
  const now = Date.now();
  if (cachedSettings && cachedSettings.data && (now - cachedSettings.timestamp) < SETTINGS_CACHE_TTL) {
    return cachedSettings.data;
  }
  const result = await repo.getAll();
  cachedSettings = { data: result, timestamp: Date.now() };
  return result;
}

export async function saveSettings(
  settings: Settings,
  updateAllowedUrlsFlag: boolean = false,
  sqliteHealthCheck?: () => Promise<boolean>
): Promise<void> {
  cachedSettings = null;
  let toSave = { ...settings };
  if (updateAllowedUrlsFlag) {
    const currentSettings = await repo.getAll();
    const mergedSettings = { ...currentSettings, ...toSave };
    const allowedUrls = buildAllowedUrls(mergedSettings);
    const allowedUrlsHash = computeUrlsHash(allowedUrls);
    toSave = {
      ...toSave,
      [StorageKeys.ALLOWED_URLS]: Array.from(allowedUrls),
      [StorageKeys.ALLOWED_URLS_HASH]: allowedUrlsHash
    };
  }
  // Delegate the quota check to ChromeStorageAdapter.setSettings. The explicit
  // health check is threaded through so callers (tests) can inject one without
  // a second ensureStorageQuota pass here; ensureStorageQuota resolves
  // injected -> lazy SqliteClient-backed fallback internally.
  if (sqliteHealthCheck) {
    await repo.setAll(toSave, { sqliteHealthCheck });
  } else {
    await repo.setAll(toSave);
  }
  if (updateAllowedUrlsFlag) {
    const { updateDomainFilterCache } = await import('./domainFilterCache.js');
    await updateDomainFilterCache(toSave);
  }
}

export async function saveSettingsWithAllowedUrls(settings: Settings): Promise<void> {
  await saveSettings(settings, true);
}

export function clearSettingsCache(): void {
  cachedSettings = null;
}

export { purgeLegacyStorage } from './savedUrlRepository.js';
export { API_KEY_FIELDS } from './settingsMigration.js';
export { ALLOWED_AI_PROVIDER_DOMAINS, isDomainInWhitelist, buildAllowedUrls, computeUrlsHash, getAllowedUrls } from './urlWhitelist.js';
export { LEGACY_SETTINGS_BACKUP_KEY, migrateToSingleSettingsObject, cleanupExpiredSettingsBackups } from './settingsMigration.js';
export { setSqliteHealthCheck, getSqliteHealthCheck } from './storageMaintenance.js';
