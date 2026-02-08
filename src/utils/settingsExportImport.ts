/**
 * settingsExportImport.ts
 * Settings export and import functionality
 */

import { getSettings, saveSettings } from './storage.js';
import type { Settings } from '../types.js';

/** Current export format version */
export const EXPORT_VERSION = '1.0.0';

/**
 * Settings export data structure
 */
export interface SettingsExportData {
  version: string;
  exportedAt: string;
  settings: Settings;
}

/**
 * Generate filename for export with timestamp
 * @returns filename for settings export
 */
function getExportFilename(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `obsidian-smart-history-settings-${year}${month}${day}-${hours}${minutes}${seconds}.json`;
}

/**
 * Export all settings to a JSON file
 * @throws Error if export fails
 */
export async function exportSettings(): Promise<void> {
  const settings = await getSettings();

  const exportData: SettingsExportData = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
  };

  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = getExportFilename();
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Validate export data structure
 * @param data - data to validate
 * @returns true if data is valid SettingsExportData
 */
export function validateExportData(data: unknown): data is SettingsExportData {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const obj = data as Record<string, unknown>;

  // Check required fields
  if (typeof obj.version !== 'string') {
    return false;
  }

  if (typeof obj.exportedAt !== 'string') {
    return false;
  }

  if (typeof obj.settings !== 'object' || obj.settings === null) {
    return false;
  }

  // Check if settings has the required keys
  const settings = obj.settings as Record<string, unknown>;
  const requiredKeys = [
    'obsidian_api_key', 'obsidian_protocol', 'obsidian_port',
    'gemini_api_key', 'min_visit_duration', 'min_scroll_depth',
    'gemini_model', 'obsidian_daily_path', 'ai_provider',
    'openai_base_url', 'openai_api_key', 'openai_model',
    'openai_2_base_url', 'openai_2_api_key', 'openai_2_model',
    'domain_whitelist', 'domain_blacklist', 'domain_filter_mode',
    'privacy_mode', 'pii_confirmation_ui', 'pii_sanitize_logs',
    'ublock_rules', 'ublock_sources', 'ublock_format_enabled',
    'simple_format_enabled',
  ];

  for (const key of requiredKeys) {
    if (!(key in settings)) {
      return false;
    }
  }

  return true;
}

/**
 * Import settings from JSON string
 * @param jsonData - JSON string containing export data
 * @returns imported Settings or null if validation fails
 */
export async function importSettings(jsonData: string): Promise<Settings | null> {
  try {
    const parsed = JSON.parse(jsonData);

    if (!validateExportData(parsed)) {
      return null;
    }

    // Version compatibility check (for future use)
    if (parsed.version !== EXPORT_VERSION) {
      console.warn(`Settings version mismatch. Expected ${EXPORT_VERSION}, got ${parsed.version}.
      Proceeding with import anyway.`);
    }

    await saveSettings(parsed.settings);
    return parsed.settings;
  } catch (error) {
    console.error('Failed to import settings:', error);
    return null;
  }
}