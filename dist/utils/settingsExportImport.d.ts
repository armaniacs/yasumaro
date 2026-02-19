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
export interface EncryptedExportData {
    encrypted: true;
    version: string;
    exportedAt: string;
    ciphertext: string;
    iv: string;
    hmac: string;
    salt: string;
}
export type ExportFileData = SettingsExportData | EncryptedExportData;
/**
 * マスターパスワードで暗号化して設定をエクスポート
 * @param {string} masterPassword - マスターパスワード
 * @returns {Promise<{ success: boolean; encryptedData?: EncryptedExportData; error?: string }>}
 */
export declare function exportEncryptedSettings(masterPassword: string): Promise<{
    success: boolean;
    encryptedData?: EncryptedExportData;
    error?: string;
}>;
/**
 * マスターパスワードで復号して設定をインポート
 * @param {string} jsonData - 暗号化されたエクスポートデータのJSON文字列
 * @param {string} masterPassword - マスターパスワード
 * @returns {Promise<Settings|null>}
 */
export declare function importEncryptedSettings(jsonData: string, masterPassword: string): Promise<Settings | null>;
/**
 * エクスポートデータが暗号化されているかどうかを判定
 */
export declare function isEncryptedExport(data: unknown): data is EncryptedExportData;
/**
 * Export all settings to a JSON file
 */
export declare function exportSettings(): Promise<void>;
/**
 * 暗号化エクスポートデータをファイルとして保存
 */
export declare function saveEncryptedExportToFile(encryptedData: EncryptedExportData): Promise<void>;
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