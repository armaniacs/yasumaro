/**
 * settingsUiHelper.ts
 * Helper for binding settings to DOM inputs.
 */

interface Settings {
    [key: string]: any;
}

/**
 * Show a timed status message on a DOM element.
 * @param {string} elementId - The DOM element ID to show the message in
 * @param {string} message - Message text
 * @param {'success'|'error'} type - Message type
 */
export function showStatus(elementId: string, message: string, type: 'success' | 'error'): void {
    const el = document.getElementById(elementId);
    if (!el) return;

    el.textContent = message;
    el.className = type;

    const timeout = type === 'error' ? 5000 : 3000;
    setTimeout(() => {
        if (el) {
            el.textContent = '';
            el.className = '';
        }
    }, timeout);
}

/**
 * Load settings into DOM inputs based on a mapping object.
 * @param {Object} settings - Settings object from storage
 * @param {Object} mapping - Object mapping StorageKeys to DOM elements
 */
export function loadSettingsToInputs(settings: Settings, mapping: Record<string, HTMLElement | null>): void {
    // APIキーフィールドのリスト
    const apiKeyFields = ['obsidian_api_key', 'gemini_api_key', 'openai_api_key', 'openai_2_api_key'];

    for (const [key, element] of Object.entries(mapping)) {
        if (!element) continue;

        const value = settings[key];

        // APIキーフィールドは、既に設定されている場合は空のままにする
        // (セキュリティのため、保存済みのAPIキーは表示しない)
        if (apiKeyFields.includes(key) && element instanceof HTMLInputElement && element.type === 'password') {
            if (value && value !== '') {
                // APIキーが設定されている場合は、プレースホルダーのみ表示
                element.placeholder = '●●●●●●●● (Already set)';
                element.value = '';
            }
            continue;
        }

        if (value !== undefined && value !== null) {
            if (element instanceof HTMLInputElement && element.type === 'checkbox') {
                element.checked = !!value;
            } else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
                element.value = String(value);
            }
        }
    }
}

/**
 * Extract values from DOM inputs into a settings object.
 * @param {Object} mapping - Object mapping StorageKeys to DOM elements
 * @returns {Object} Settings object to be saved
 */
export function extractSettingsFromInputs(mapping: Record<string, HTMLElement | null>): Settings {
    const settings: Settings = {};
    const apiKeyFields = ['obsidian_api_key', 'gemini_api_key', 'openai_api_key', 'openai_2_api_key'];

    for (const [key, element] of Object.entries(mapping)) {
        if (!element) continue;

        let value: any = (element as HTMLInputElement).value;
        if (element instanceof HTMLInputElement && element.type === 'number') {
            value = parseInt(value, 10);
        } else if (element instanceof HTMLInputElement && element.type === 'checkbox') {
            value = element.checked;
        } else if (typeof value === 'string') {
            value = value.trim();
        }

        // APIキーフィールドで値が空の場合は、現在の設定を保持するためスキップ
        // (空の値で上書きしない)
        if (apiKeyFields.includes(key) && (!value || value === '')) {
            console.log(`[SettingsUI] Skipping empty API key field: ${key}`);
            continue;
        }

        settings[key] = value;

        // デバッグログ: 設定値の抽出を確認
        if (key.includes('api_key') || key.includes('API_KEY')) {
            console.log(`[SettingsUI] Extracted ${key}:`, {
                hasValue: !!value,
                length: typeof value === 'string' ? value.length : 0,
                isEmpty: value === ''
            });
        }
    }

    console.log('[SettingsUI] All extracted settings:', Object.keys(settings));
    return settings;
}
