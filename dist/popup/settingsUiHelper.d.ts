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
export declare function showStatus(elementId: string, message: string, type: 'success' | 'error'): void;
/**
 * Load settings into DOM inputs based on a mapping object.
 * @param {Object} settings - Settings object from storage
 * @param {Object} mapping - Object mapping StorageKeys to DOM elements
 */
export declare function loadSettingsToInputs(settings: Settings, mapping: Record<string, HTMLElement | null>): void;
/**
 * Extract values from DOM inputs into a settings object.
 * @param {Object} mapping - Object mapping StorageKeys to DOM elements
 * @returns {Object} Settings object to be saved
 */
export declare function extractSettingsFromInputs(mapping: Record<string, HTMLElement | null>): Settings;
export {};
//# sourceMappingURL=settingsUiHelper.d.ts.map