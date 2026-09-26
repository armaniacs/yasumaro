/**
 * Shared diagnostic panel utilities.
 * Used by both diagnosticsPanel.ts (legacy) and panels/diagnostic/diagnosticsPanel.ts.
 */
import { getMessageOr } from '../utils/i18n.js';

/** Severity level for deficiency items. */
export type Severity = 'high' | 'medium' | 'low' | string;

/**
 * Creates a stat row element for the diagnostics panel.
 * Uses createElement + textContent (no innerHTML) for XSS safety.
 */
export function makeStatRow(label: string, value: string, masked = false): HTMLElement {
  const row = document.createElement('div');
  row.className = 'diag-stat-row';

  const labelEl = document.createElement('span');
  labelEl.className = 'diag-stat-label';
  labelEl.textContent = label;
  row.appendChild(labelEl);

  const valueEl = document.createElement('span');
  valueEl.className = 'diag-stat-value';
  if (masked) {
    valueEl.classList.add('diag-stat-masked');
  }
  valueEl.textContent = value;
  row.appendChild(valueEl);

  return row;
}

/**
 * Returns the localized severity label for a deficiency severity level.
 */
export function getSeverityLabel(severity: Severity): string {
  switch (severity) {
    case 'high': return getMessageOr('diagSeverityHigh', 'High');
    case 'medium': return getMessageOr('diagSeverityMedium', 'Medium');
    case 'low': return getMessageOr('diagSeverityLow', 'Low');
    default: return severity;
  }
}
