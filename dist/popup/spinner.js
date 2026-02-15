/**
 * Loading Spinner Control Functions
 *
 * UF-403 Loading Spinner Feature
 */
import { getMessage } from './i18n.js';
/**
 * Show loading spinner
 * @param {string} text - Text to display next to spinner (optional, default: 'Processing...')
 * 🟢 Implemented based on requirements (loading-spinner-requirements.md 186-196 lines)
 */
export function showSpinner(text) {
    const spinner = document.getElementById('loadingSpinner');
    if (!spinner) {
        console.warn('loadingSpinner element not found');
        return;
    }
    const spinnerText = spinner.querySelector('.spinner-text');
    // Use provided text or default to "Processing..." from i18n
    if (spinnerText) {
        spinnerText.textContent = text || getMessage('processing');
    }
    spinner.style.display = 'flex';
}
/**
 * Hide loading spinner
 * 🟢 Implemented based on requirements (loading-spinner-requirements.md 201-204 lines)
 */
export function hideSpinner() {
    const spinner = document.getElementById('loadingSpinner');
    if (!spinner) {
        console.warn('loadingSpinner element not found');
        return;
    }
    spinner.style.display = 'none';
}
//# sourceMappingURL=spinner.js.map