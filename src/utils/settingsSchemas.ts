/**
 * settingsSchemas.ts
 * Shared SettingsSchema instances — single source of truth for
 * data-storage-key bindings. Both dashboard (options.html) and popup
 * (popup.html) import from here so they share the same schema.
 *
 * PBI#05: popup.html and options.html share the same schema — a typo in
 * data-storage-key is now a compile-time error (StorageKeys constant) and
 * adding a new setting only requires updating this file.
 */

import { StorageKeys } from './storage/types.js';
import type { SettingsSchema } from './settingsFormBinding.js';

/**
 * General settings — the 7 fields whose validation was previously
 * hardcoded in settingsPipeline.ts, plus the remaining fields that use
 * data-storage-key for load/extract.
 *
 * This schema is used by:
 * - dashboard/generalSettingsPanel.ts (via loadSettingsToInputs)
 * - dashboard/settingsPipeline.ts (via ValidationSchema, derived from same keys)
 * - popup/popup.ts (settings load/extract, if it opts into schema mode)
 */
export const GENERAL_SETTINGS_SCHEMA: SettingsSchema = [
  { key: StorageKeys.OBSIDIAN_ENABLED, type: 'checkbox' },
  { key: StorageKeys.OBSIDIAN_API_KEY, type: 'password' },
  { key: StorageKeys.OBSIDIAN_PROTOCOL, type: 'text' },
  { key: StorageKeys.OBSIDIAN_PORT, type: 'number' },
  { key: StorageKeys.OBSIDIAN_HOST, type: 'text' },
  { key: StorageKeys.OBSIDIAN_DAILY_PATH, type: 'text' },
  { key: StorageKeys.GEMINI_API_KEY, type: 'password' },
  { key: StorageKeys.GEMINI_MODEL, type: 'text' },
  { key: StorageKeys.GEMINI_API_VERSION, type: 'text' },
  { key: StorageKeys.OPENAI_BASE_URL, type: 'text' },
  { key: StorageKeys.OPENAI_API_KEY, type: 'password' },
  { key: StorageKeys.OPENAI_MODEL, type: 'text' },
  { key: StorageKeys.OPENAI_2_BASE_URL, type: 'text' },
  { key: StorageKeys.OPENAI_2_API_KEY, type: 'password' },
  { key: StorageKeys.OPENAI_2_MODEL, type: 'text' },
  { key: StorageKeys.LM_STUDIO_BASE_URL, type: 'text' },
  { key: StorageKeys.LM_STUDIO_MODEL, type: 'text' },
  { key: StorageKeys.OLLAMA_BASE_URL, type: 'text' },
  { key: StorageKeys.OLLAMA_MODEL, type: 'text' },
  { key: StorageKeys.PROVIDER_BASE_URL, type: 'text' },
  { key: StorageKeys.PROVIDER_API_KEY, type: 'password' },
  { key: StorageKeys.PROVIDER_MODEL, type: 'text' },
  { key: StorageKeys.MIN_VISIT_DURATION, type: 'number' },
  { key: StorageKeys.MIN_SCROLL_DEPTH, type: 'number' },
  { key: StorageKeys.MAX_TOKENS_PER_PROMPT, type: 'number' },
  { key: StorageKeys.AI_PROVIDER, type: 'select' },
  { key: StorageKeys.AI_PROVIDER_LAYOUT, type: 'select' },
  { key: StorageKeys.SQLITE_RETENTION_DAYS, type: 'select' },
  { key: StorageKeys.SQLITE_MAX_RECORDS, type: 'select' },
  { key: StorageKeys.CONTENT_RETENTION_DAYS, type: 'select' },
  { key: StorageKeys.CONTENT_MAX_RECORDS, type: 'select' },
  { key: StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED, type: 'checkbox' },
  { key: StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH, type: 'text' },
  { key: StorageKeys.REVIEW_SUMMARY_ENABLED, type: 'checkbox' },
];
