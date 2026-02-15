/**
 * settingsExportImport.ts
 * Settings export and import functionality
 */
import { Settings } from './storage.js';
/** Current export format version */
export declare const EXPORT_VERSION = "1.0.0";
export interface SettingsExportData {
    version: string;
    exportedAt: string;
    settings: Settings;
    apiKeyExcluded: boolean;
    signature?: string;
}
/**
 * Export all settings to a JSON file
 */
export declare function exportSettings(): Promise<void>;
/**
 * Validate export data structure
 * @param {unknown} data - data to validate
 * @returns {boolean} true if data is valid
 */
export declare function validateExportData(data: any): boolean;
/**
 * Import settings from JSON string
 * @param {string} jsonData - JSON string containing export data
 * @returns {Promise<Settings|null>} imported Settings or null if validation fails
 */
export declare function importSettings(jsonData: string): Promise<Settings | null>;
//# sourceMappingURL=settingsExportImport.d.ts.map