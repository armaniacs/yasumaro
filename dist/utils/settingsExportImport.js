/**
 * settingsExportImport.ts
 * Settings export and import functionality
 */
import { getSettings, saveSettings, getOrCreateHmacSecret } from './storage.js';
import { computeHMAC } from './crypto.js';
/** Current export format version */
export const EXPORT_VERSION = '1.0.0';
// APIキーフィールドのリスト
const API_KEY_FIELDS = [
    'obsidian_api_key',
    'gemini_api_key',
    'openai_api_key',
    'openai_2_api_key',
];
/**
 * APIキーフィールドを除外した設定を取得する
 * @param {Settings} settings - 元の設定
 * @returns {Settings} APIキーが除外された設定
 */
function sanitizeSettingsForExport(settings) {
    const sanitized = { ...settings };
    for (const field of API_KEY_FIELDS) {
        delete sanitized[field];
    }
    return sanitized;
}
/**
 * Generate filename for export with timestamp
 * @returns {string} filename for settings export
 */
function getExportFilename() {
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
 */
export async function exportSettings() {
    const settings = await getSettings();
    // APIキーを除外した設定でエクスポート
    const sanitizedSettings = sanitizeSettingsForExport(settings);
    const exportData = {
        version: EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        settings: sanitizedSettings,
        // APIキー除外フラグを追加
        apiKeyExcluded: true,
    };
    const json = JSON.stringify(exportData, null, 2);
    // HMAC署名を計算
    const hmacSecret = await getOrCreateHmacSecret();
    const signature = await computeHMAC(hmacSecret, json);
    // 署名付きエクスポートデータ
    const signedExportData = {
        ...exportData,
        signature,
    };
    const signedJson = JSON.stringify(signedExportData, null, 2);
    const blob = new Blob([signedJson], { type: 'application/json' });
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
 * @param {unknown} data - data to validate
 * @returns {boolean} true if data is valid
 */
export function validateExportData(data) {
    if (typeof data !== 'object' || data === null) {
        return false;
    }
    // Check required fields
    if (typeof data.version !== 'string') {
        return false;
    }
    if (typeof data.exportedAt !== 'string') {
        return false;
    }
    if (typeof data.settings !== 'object' || data.settings === null) {
        return false;
    }
    const settings = data.settings;
    // APIキーが除外されている場合、APIキーフィールドのチェックをスキップ
    const apiKeyExcluded = data.apiKeyExcluded === true;
    const requiredKeys = [
        'obsidian_protocol', 'obsidian_port',
        'min_visit_duration', 'min_scroll_depth',
        'gemini_model', 'obsidian_daily_path', 'ai_provider',
        'openai_base_url', 'openai_model',
        'openai_2_base_url', 'openai_2_model',
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
    // APIキーフィールドのチェック（ apiKeyExcluded がある場合はスキップ）
    if (!apiKeyExcluded) {
        const apiKeyKeys = [
            'obsidian_api_key', 'gemini_api_key',
            'openai_api_key', 'openai_2_api_key',
        ];
        for (const key of apiKeyKeys) {
            if (!(key in settings)) {
                return false;
            }
        }
    }
    return true;
}
/**
 * Import settings from JSON string
 * @param {string} jsonData - JSON string containing export data
 * @returns {Promise<Settings|null>} imported Settings or null if validation fails
 */
export async function importSettings(jsonData) {
    try {
        const parsed = JSON.parse(jsonData);
        // 署名があるかチェック
        if (!parsed.signature) {
            console.warn('Imported settings has no signature. Proceeding without verification.');
            // 署名がない場合はユーザーに警告し、確認を求める
            const proceed = confirm('⚠️ この設定ファイルには署名が含まれていません。\n\n' +
                '署名は設定ファイルの改ざん防止のために使用されます。\n' +
                '信頼できないソースからのファイルはインポートしないことを推奨します。\n\n' +
                'インポートを続行しますか？');
            if (!proceed) {
                console.info('Import cancelled by user due to missing signature.');
                return null;
            }
            // 旧形式のエクスポートファイルとの互換性のため、署名検証なしで続行
        }
        else {
            // 署名検証
            const hmacSecret = await getOrCreateHmacSecret();
            // 署名を除いてハッシュ計算
            const { signature, ...dataForVerification } = parsed;
            const dataJson = JSON.stringify(dataForVerification, null, 2);
            const computedSignature = await computeHMAC(hmacSecret, dataJson);
            if (signature !== computedSignature) {
                console.error('Signature verification failed. Settings may have been tampered with.');
                alert('設定ファイルの署名検証に失敗しました。ファイルが改ざんされている可能性があります。');
                return null;
            }
        }
        // 構造検証（既存のvalidateExportDataを使用）
        if (!validateExportData(parsed)) {
            return null;
        }
        // APIキーが除外されている場合、インポートしない
        if (parsed.apiKeyExcluded) {
            console.info('Imported settings have API keys excluded. Existing API keys will be preserved.');
            // 既存の設定を取得し、APIキーのみ維持
            const existingSettings = await getSettings();
            const { obsidian_api_key, gemini_api_key, openai_api_key, openai_2_api_key, ...imported } = parsed.settings;
            const merged = {
                ...imported,
                obsidian_api_key: existingSettings.obsidian_api_key,
                gemini_api_key: existingSettings.gemini_api_key,
                openai_api_key: existingSettings.openai_api_key,
                openai_2_api_key: existingSettings.openai_2_api_key,
            };
            await saveSettings(merged);
            return merged;
        }
        await saveSettings(parsed.settings);
        return parsed.settings;
    }
    catch (error) {
        console.error('Failed to import settings:', error);
        return null;
    }
}
//# sourceMappingURL=settingsExportImport.js.map