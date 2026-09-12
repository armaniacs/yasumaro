/**
 * Loading Spinner Control Functions
 *
 * UF-403 Loading Spinner Feature
 */

import { getMessage } from '../utils/i18n.js';

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

/**
 * SpinnerScope — balanced show/hide ownership (PBI 2026-09-12-14).
 *
 * Show/hide pairs used to scatter across the flow that shows and the
 * session finish paths that hide, so a new early return could strand a
 * visible spinner. A scope closes its own pair in `hide()` (idempotent —
 * the session-level `hideSpinner()` calls stay valid), and callers wrap the
 * operation in try/finally so every exit path balances.
 */
export class SpinnerScope {
  private shown = false;

  show(text?: string): void {
    showSpinner(text);
    this.shown = true;
  }

  hide(): void {
    if (this.shown) {
      hideSpinner();
      this.shown = false;
    }
  }
}