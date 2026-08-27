/**
 * settingsConfiguredCheck.ts
 * Shared `isConfigured` check for SyncTarget implementations.
 * Unifies the previously divergent checks (SettingsRepository.getAll() for Gist,
 * raw chrome.storage.local.get for Obsidian) behind one SettingsReader-backed predicate.
 */

import type { SettingsReader } from '../../utils/storage/SettingsRepository.js';
import type { StorageKey } from '../../utils/storage/types.js';

/**
 * Returns true when the string value stored at `key` has at least `minLength` characters.
 * Any read failure (storage error, decryption failure) is treated as "not configured"
 * so callers can silently skip sync rather than throw.
 */
export async function isCredentialConfigured(reader: SettingsReader, key: StorageKey, minLength = 1): Promise<boolean> {
  try {
    const settings = await reader.getMany([key]);
    const value = settings[key];
    return typeof value === 'string' && value.length >= minLength;
  } catch {
    return false;
  }
}
