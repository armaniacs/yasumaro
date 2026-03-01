/**
 * settingsExportImport.ts
 * Settings export and import functionality
 */
import { getSettings, saveSettings, getOrCreateHmacSecret } from './storage.js';
import { computeHMAC, encrypt, decryptData, deriveKey } from './crypto.js';
import { generateSalt } from './crypto.js';
import { API_KEY_FIELDS } from './storageSettings.js';
/** Current export format version */
export const EXPORT_VERSION = '1.0.0';
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
 * インポート設定とAPIキーをマージする（APIキー除外時の共通処理）
 */
async function mergeWithExistingApiKeys(importedSettings) {
    const existingSettings = await getSettings();
    const merged = { ...importedSettings };
    for (const field of API_KEY_FIELDS) {
        merged[field] = existingSettings[field];
    }
    return merged;
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
    return `obsidian-weave-settings-${year}${month}${day}-${hours}${minutes}${seconds}.json`;
}
/**
 * マスターパスワードで暗号化して設定をエクスポート
 * @param {string} masterPassword - マスターパスワード
 * @returns {Promise<{ success: boolean; encryptedData?: EncryptedExportData; error?: string }>}
 */
export async function exportEncryptedSettings(masterPassword) {
    try {
        const settings = await getSettings();
        // APIキーを除外した設定でエクスポート
        const sanitizedSettings = sanitizeSettingsForExport(settings);
        const exportData = {
            version: EXPORT_VERSION,
            exportedAt: new Date().toISOString(),
            settings: sanitizedSettings,
            apiKeyExcluded: true,
        };
        const json = JSON.stringify(exportData, null, 2);
        // ソルト生成
        const salt = generateSalt();
        // パスワードからキーを派生（PBKDF2）
        const key = await deriveKey(masterPassword, salt);
        // データを暗号化
        const encrypted = await encrypt(json, key);
        // HMAC署名を計算（元のデータに対して）
        const hmacSecret = await getOrCreateHmacSecret();
        const hmac = await computeHMAC(hmacSecret, json);
        const encryptedExportData = {
            encrypted: true,
            version: EXPORT_VERSION,
            exportedAt: new Date().toISOString(),
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            hmac: hmac,
            salt: btoa(String.fromCharCode(...salt)),
        };
        return { success: true, encryptedData: encryptedExportData };
    }
    catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}
/**
 * マスターパスワードで復号して設定をインポート
 * @param {string} jsonData - 暗号化されたエクスポートデータのJSON文字列
 * @param {string} masterPassword - マスターパスワード
 * @returns {Promise<Settings|null>}
 */
export async function importEncryptedSettings(jsonData, masterPassword) {
    try {
        const encryptedData = JSON.parse(jsonData);
        // 暗号化されたデータかどうか確認
        if (!encryptedData.encrypted) {
            console.error('This is not an encrypted export file');
            return null;
        }
        // ソルトをデコード
        const salt = new Uint8Array(atob(encryptedData.salt).split('').map(c => c.charCodeAt(0)));
        // パスワードからキーを派生
        const key = await deriveKey(masterPassword, salt);
        // データを復号
        const decryptedJson = await decryptData({ ciphertext: encryptedData.ciphertext, iv: encryptedData.iv }, key);
        // HMAC署名検証
        const hmacSecret = await getOrCreateHmacSecret();
        const computedHmac = await computeHMAC(hmacSecret, decryptedJson);
        if (encryptedData.hmac !== computedHmac) {
            console.error('HMAC verification failed. Data may have been tampered with.');
            const forceImport = confirm('設定ファイルの署名検証に失敗しました。\n\n' +
                '原因: HMACシークレットが変更された可能性があります（拡張機能の更新・再ロード等）。\n\n' +
                '信頼できる設定ファイルの場合は「OK」をクリックして強制インポートしてください。\n' +
                '信頼できない場合は「キャンセル」をクリックしてください。');
            if (!forceImport) {
                return null;
            }
            console.warn('Force importing encrypted settings despite HMAC verification failure');
        }
        // 復号されたJSONを解析してインポート
        const parsed = JSON.parse(decryptedJson);
        // 構造検証
        if (!validateExportData(parsed)) {
            return null;
        }
        // APIキーが除外されている場合
        if (parsed.apiKeyExcluded) {
            console.info('Imported settings have API keys excluded. Existing API keys will be preserved.');
            const merged = await mergeWithExistingApiKeys(parsed.settings);
            await saveSettings(merged);
            return merged;
        }
        await saveSettings(parsed.settings);
        return parsed.settings;
    }
    catch (error) {
        console.error('Failed to import encrypted settings:', error);
        return null;
    }
}
/**
 * エクスポートデータが暗号化されているかどうかを判定
 */
export function isEncryptedExport(data) {
    const obj = data;
    return typeof data === 'object' &&
        data !== null &&
        'encrypted' in obj &&
        obj.encrypted === true;
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
 * 暗号化エクスポートデータをファイルとして保存
 */
export async function saveEncryptedExportToFile(encryptedData) {
    const json = JSON.stringify(encryptedData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = getExportFilename().replace('.json', '-encrypted.json');
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
        // 【セキュリティ強化】署名があるかチェック
        // 【実装方針】: 署名なしファイルは即時拒否（警告ダイアログなし）
        // 【テスト対応】: settingsExportImport-signature.test.ts
        // 🟢 信頼性レベル: 青信号（要件定義書の署名強化仕様通り）
        if (!parsed.signature) {
            console.error('Import rejected: Missing signature.');
            alert('設定ファイルに署名が含まれていません。署名付きのファイルのみインポート可能です。');
            return null; // 旧形式の互換性を削除
        }
        // 署名検証
        const hmacSecret = await getOrCreateHmacSecret();
        // 署名を除いてハッシュ計算
        const { signature, ...dataForVerification } = parsed;
        const dataJson = JSON.stringify(dataForVerification, null, 2);
        const computedSignature = await computeHMAC(hmacSecret, dataJson);
        if (signature !== computedSignature) {
            console.error('Signature verification failed. Settings may have been tampered with.');
            const forceImport = confirm('設定ファイルの署名検証に失敗しました。\n\n' +
                '原因: HMACシークレットが変更された可能性があります（拡張機能の更新・再ロード等）。\n\n' +
                '信頼できる設定ファイルの場合は「OK」をクリックして強制インポートしてください。\n' +
                '信頼できない場合は「キャンセル」をクリックしてください。');
            if (!forceImport) {
                return null;
            }
            console.warn('Force importing settings despite signature verification failure');
        }
        // 構造検証（既存のvalidateExportDataを使用）
        if (!validateExportData(parsed)) {
            return null;
        }
        // APIキーが除外されている場合、インポートしない
        if (parsed.apiKeyExcluded) {
            console.info('Imported settings have API keys excluded. Existing API keys will be preserved.');
            const merged = await mergeWithExistingApiKeys(parsed.settings);
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