import type { StorageKey } from './types.js';

/**
 * Canonical list of settings fields that hold API keys or tokens.
 *
 * Single source of truth for API-key redaction (storagePort),
 * migration/encryption (settingsMigration), export sanitizing
 * (settingsExportImport) and log masking (sensitiveDataMask).
 *
 * Kept as string literals in a dependency-free module so it can be
 * imported from storagePort without pulling StorageKeys — SettingsRepository
 * mocks hoisted above the StorageKeys definition would otherwise leave
 * StorageKeys undefined at import time.
 */
export const API_KEY_FIELD_NAMES: readonly string[] = [
  'obsidian_api_key',
  'gemini_api_key',
  'openai_api_key',
  'openai_2_api_key',
  'provider_api_key',
  'github_pat',
] as const;

const NORMALIZED_API_KEY_FIELDS = new Set(
  API_KEY_FIELD_NAMES.map((f) => f.toLowerCase().replace(/_/g, '')),
);

export function isApiKeyField(field: string): boolean {
  return NORMALIZED_API_KEY_FIELDS.has(field.toLowerCase().replace(/_/g, ''));
}

export function asStorageKeys(): StorageKey[] {
  return [...API_KEY_FIELD_NAMES] as StorageKey[];
}
