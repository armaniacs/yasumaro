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
export function showSpinner(text?: string): void {
  const spinner = document.getElementById('loadingSpinner');
  if (!spinner) {
    console.warn('loadingSpinner element not found');
    return;
  }
  spinner.setAttribute('role', 'status');
  spinner.setAttribute('aria-live', 'polite');
  const spinnerText = spinner.querySelector('.spinner-text');
  if (spinnerText) {
    spinnerText.textContent = text || getMessage('processing');
  }
  spinner.style.display = 'flex';
}

/**
 * Hide loading spinner
 * 🟢 Implemented based on requirements (loading-spinner-requirements.md 201-204 lines)
 */
export function hideSpinner(): void {
  const spinner = document.getElementById('loadingSpinner');
  if (!spinner) {
    console.warn('loadingSpinner element not found');
    return;
  }
  spinner.style.display = 'none';
}