// @vitest-environment jsdom
/**
 * diagnosticUtils.test.ts
 * Branch-coverage tests for diagnostic panel utilities.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/i18n.js', () => {
  const getMessage = vi.fn((key: string) => {
    const map: Record<string, string> = {
      diagSeverityHigh: 'High',
      diagSeverityMedium: 'Medium',
      diagSeverityLow: 'Low',
    };
    return map[key] || key;
  });
  const getMessageOr = (key: string, fallback: string, subs?: unknown): string =>
  ((subs === undefined ? (getMessage as (...a: any[]) => unknown)(key) : (getMessage as (...a: any[]) => unknown)(key, subs)) || fallback) as string;
  const getMessageWithSubstitutions = (
  key: string,
  subs: Record<string, string | number>,
  fallback: string,
      ): string =>
      ((getMessage as (...a: any[]) => unknown)(key, subs) ||
  fallback.replace(/\{(\w+)\}/g, (_m: string, n: string) =>
    subs[n] !== undefined ? String(subs[n]) : `{${n}}`)) as string;
  return {
  getMessage: getMessage, getMessageOr, getMessageWithSubstitutions
}; });

import { makeStatRow, getSeverityLabel } from '../diagnosticUtils.js';

describe('makeStatRow', () => {
  it('creates row without mask by default', () => {
    const row = makeStatRow('Label', 'Value');
    expect(row.className).toBe('diag-stat-row');
    expect(row.querySelector('.diag-stat-label')!.textContent).toBe('Label');
    const valueEl = row.querySelector('.diag-stat-value')!;
    expect(valueEl.textContent).toBe('Value');
    expect(valueEl.classList.contains('diag-stat-masked')).toBe(false);
  });

  it('creates row with mask when masked is true', () => {
    const row = makeStatRow('Label', 'Value', true);
    expect(row.querySelector('.diag-stat-value')!.classList.contains('diag-stat-masked')).toBe(true);
  });
});

describe('getSeverityLabel', () => {
  it('returns localized label for high', () => {
    expect(getSeverityLabel('high')).toBe('High');
  });

  it('returns localized label for medium', () => {
    expect(getSeverityLabel('medium')).toBe('Medium');
  });

  it('returns localized label for low', () => {
    expect(getSeverityLabel('low')).toBe('Low');
  });

  it('returns raw value for unknown severity', () => {
    expect(getSeverityLabel('critical')).toBe('critical');
  });
});
