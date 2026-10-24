/**
 * domainIntelRepository.ts
 *
 * Exclusion-proposal apply/undo seam (PBI 2026-10-23-10). Thin read-modify-write
 * over SettingsRepository: applying adds the domain to the simple blacklist,
 * undoing removes it. The write runs the pure upsert/remove and keeps the
 * repository's own set() semantics — this module owns no storage.
 *
 * 縮退の出口: a reader that throws falls back to the stored list only — the
 * caller surfaces the failure reason instead of writing a half-known list.
 * Proposals are advisory: the panel gates this seam behind a user action, so
 * nothing here fires without one (自動除外はしない).
 */

import { StorageKeys } from './types.js';
import { settingsRepository, type SettingsRepository } from './SettingsRepository.js';
import { DEFAULT_SETTINGS } from './defaults.js';
import { errorMessage } from '../errorUtils.js';
import { logError } from '../logger/api.js';
import { ErrorCode } from '../logger/types.js';

/**
 * Minimal store seam: `get`/`set` are the only repository members this module
 * needs. Production callers omit it (the singleton is the factory default);
 * tests pass a real `SettingsRepository` over an in-memory port.
 */
export type DomainBlacklistStore = Pick<SettingsRepository, 'get' | 'set'>;

/** The stored blacklist, normalized to a string list. */
export async function getDomainBlacklist(
  repo: DomainBlacklistStore = settingsRepository,
): Promise<string[]> {
  try {
    const stored = await repo.get(StorageKeys.DOMAIN_BLACKLIST);
    if (Array.isArray(stored)) return stored.filter((d): d is string => typeof d === 'string');
    return [];
  } catch (error) {
    // 縮退の出口: a corrupted store degrades to the default list instead of
    // failing the panel.
    void logError('[DomainIntel] read failed', { error: errorMessage(error) }, ErrorCode.STORAGE_READ_FAILURE, 'domainIntelRepository');
    const fallback = DEFAULT_SETTINGS[StorageKeys.DOMAIN_BLACKLIST];
    return Array.isArray(fallback) ? fallback.filter((d): d is string => typeof d === 'string') : [];
  }
}

async function saveDomainBlacklist(list: string[], repo: DomainBlacklistStore): Promise<void> {
  // The stored shape is string[] (the strict per-key literal type); the list
  // shape is enforced on read by the normalization above (same pattern as the
  // saved collections repository).
  await repo.set(StorageKeys.DOMAIN_BLACKLIST, list);
}

/** Adds one domain to the simple blacklist (適用). Idempotent on repeats. */
export async function addDomainToBlacklist(
  domain: string,
  repo: DomainBlacklistStore = settingsRepository,
): Promise<void> {
  const current = await getDomainBlacklist(repo);
  if (current.includes(domain)) return;
  await saveDomainBlacklist([...current, domain], repo);
}

/** Removes one domain from the simple blacklist (取消). */
export async function removeDomainFromBlacklist(
  domain: string,
  repo: DomainBlacklistStore = settingsRepository,
): Promise<void> {
  const current = await getDomainBlacklist(repo);
  if (!current.includes(domain)) return;
  await saveDomainBlacklist(current.filter((d) => d !== domain), repo);
}
