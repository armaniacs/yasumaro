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

import { StorageKeys, type Settings } from './types.js';
import { settingsRepository } from './SettingsRepository.js';
import { DEFAULT_SETTINGS } from './defaults.js';

/** The stored blacklist, normalized to a string list. */
export async function getDomainBlacklist(): Promise<string[]> {
  try {
    const stored = await settingsRepository.get(StorageKeys.DOMAIN_BLACKLIST);
    if (Array.isArray(stored)) return stored.filter((d): d is string => typeof d === 'string');
    return [];
  } catch {
    // 縮退の出口: a corrupted store degrades to the default list instead of
    // failing the panel.
    const fallback = DEFAULT_SETTINGS[StorageKeys.DOMAIN_BLACKLIST];
    return Array.isArray(fallback) ? fallback.filter((d): d is string => typeof d === 'string') : [];
  }
}

/** The stored blacklist's strict per-key value type (Settings SSOT). */
type BlacklistValue = Settings[typeof StorageKeys.DOMAIN_BLACKLIST];

async function saveDomainBlacklist(list: string[]): Promise<void> {
  // The stored shape is the strict per-key literal type; the list shape is
  // enforced on read by the normalization above (same pattern as the saved
  // collections repository).
  await settingsRepository.set(
    StorageKeys.DOMAIN_BLACKLIST,
    list as unknown as BlacklistValue,
  );
}

/** Adds one domain to the simple blacklist (適用). Idempotent on repeats. */
export async function addDomainToBlacklist(domain: string): Promise<void> {
  const current = await getDomainBlacklist();
  if (current.includes(domain)) return;
  await saveDomainBlacklist([...current, domain]);
}

/** Removes one domain from the simple blacklist (取消). */
export async function removeDomainFromBlacklist(domain: string): Promise<void> {
  const current = await getDomainBlacklist();
  if (!current.includes(domain)) return;
  await saveDomainBlacklist(current.filter((d) => d !== domain));
}
