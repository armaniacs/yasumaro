// @vitest-environment jsdom
/**
 * sqliteHistoryPanelRegenerate.test.ts — mapRegenerateError sentinel → i18n
 * matrix (PBI 2026-09-22-04). The function is exported from the panel module
 * purely for this pin; the heavy import graph is mocked exactly like
 * sqliteHistoryPanel-pending.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../dashboardSqliteService.js', () => ({
  queryLogs: vi.fn(),
  searchLogs: vi.fn(),
  toggleStar: vi.fn(),
  deleteLog: vi.fn(),
  getSqliteStatus: vi.fn().mockResolvedValue({ initialized: true, fallback: false }),
  appendToLogs: vi.fn(),
  isServiceError: (result: object) => 'error' in result,
}));

vi.mock('../../../../utils/storageUrls.js', () => ({
  getSavedUrlEntries: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../../utils/pendingStorage.js', () => ({
  getPendingPages: vi.fn().mockResolvedValue([]),
  removePendingPages: vi.fn().mockResolvedValue(undefined),
  renderPendingReason: vi.fn((r: string) => r),
}));

vi.mock('../../../../messaging/regenerateSummaryGateway.js', () => ({
  regenerateSummary: vi.fn(),
  REGENERATE_TIMEOUT_ERROR: 'Regenerate summary request timed out',
  REGENERATE_TIMEOUT_MS: 60000,
}));

import { mapRegenerateError, formatRegenerateErrorDetail } from '../sqliteHistoryPanel.js';
import { REGENERATE_TIMEOUT_ERROR } from '../../../../messaging/regenerateSummaryGateway.js';

// NOTE: t() resolves to the en-locale message in vitest (same convention as
// the view tests asserting English reason strings).
describe('mapRegenerateError (CRITICAL: raw handler strings are never rendered)', () => {
  it('maps every known sentinel to its localized message', () => {
    expect(mapRegenerateError('invalid_url', false)).toBe('This URL cannot be regenerated.');
    expect(mapRegenerateError('rate_limited', false)).toContain('rate limit reached');
    expect(mapRegenerateError('rate limit exceeded', false)).toContain('rate limit reached');
    expect(mapRegenerateError('fetch_failed: tab_load_timeout', false)).toBe('Failed to re-fetch the page.');
    expect(mapRegenerateError(REGENERATE_TIMEOUT_ERROR, false)).toContain('timed out');
    expect(mapRegenerateError('privacy_consent_required', false)).toBe('Recording privacy consent is required.');
    expect(mapRegenerateError(undefined, false)).toBe('Failed to regenerate the AI summary.');
    expect(mapRegenerateError('SOME_UNKNOWN', false)).toBe('Failed to regenerate the AI summary.');
  });

  it('prefers the gate-blocked message whenever needsForce is true (force action row)', () => {
    expect(mapRegenerateError('DOMAIN_BLOCKED', true)).toContain('force regeneration');
    expect(mapRegenerateError(undefined, true)).toContain('force regeneration');
  });

  it('passes Error-prefixed strings through unchanged', () => {
    expect(mapRegenerateError('Error: boom', false)).toBe('Error: boom');
  });
});

describe('mapRegenerateError — rate-limit matching (review fix)', () => {
  it("matches the RateLimiter's capitalised message case-insensitively", () => {
    expect(mapRegenerateError('Rate limit exceeded. Please try again later.', false))
      .toContain('rate limit reached');
  });

  it('prefers the threaded reason over raw-error inspection', () => {
    expect(mapRegenerateError('anything at all', false, 'rate_limited'))
      .toContain('rate limit reached');
  });

  it('in_flight is mapped to the generic failure (panel normally stays silent instead)', () => {
    expect(mapRegenerateError('in_flight', false)).toBe('Failed to regenerate the AI summary.');
  });
});

describe('mapRegenerateError — ai_failed (PBI 2026-09-22-04 follow-up)', () => {
  it('maps ai_failed and ai_failed:* to the AI failure message', () => {
    expect(mapRegenerateError('ai_failed', false)).toBe(
      'AI summary generation failed. Try another provider in AI settings, or wait a moment and try again.',
    );
  });
});

describe('formatRegenerateErrorDetail (PBI follow-up: per-slot trail)', () => {
  it('renders the tried chain plus one line per slot failure', () => {
    const detail = formatRegenerateErrorDetail(
      ['openai', 'gemini', 'built-in-ai'],
      [
        { provider: 'openai', error: 'HTTP 401' },
        { provider: 'gemini', error: 'Error: Failed to generate summary. Please check your API settings.' },
        { provider: 'built-in-ai', error: 'Prompt failed: An unknown error occurred: kErrorUnknown' },
      ],
      'Providers tried',
    );
    expect(detail).toBe(
      'Providers tried: openai → gemini → built-in-ai\n' +
      'openai: HTTP 401\n' +
      'gemini: Error: Failed to generate summary. Please check your API settings.\n' +
      'built-in-ai: Prompt failed: An unknown error occurred: kErrorUnknown',
    );
  });

  it('returns undefined when there is nothing to show', () => {
    expect(formatRegenerateErrorDetail([], [], 'Providers tried')).toBeUndefined();
    expect(formatRegenerateErrorDetail([], undefined, 'Providers tried')).toBeUndefined();
  });
});

describe('mapRegenerateError — shared monthly quota (root cause 2026-09-22)', () => {
  const monthlyFailures = [
    { provider: 'openai', error: 'Error: Monthly token limit reached (1,017,238 / 1,000,000)' },
    { provider: 'gemini', error: 'Error: Monthly token limit reached (1,017,238 / 1,000,000)' },
    { provider: 'built-in-ai', error: 'Prompt failed: An unknown error occurred: kErrorUnknown' },
  ];

  it('ai_failed + monthly-limit slot failure → dedicated quota message (not "try another provider")', () => {
    const msg = mapRegenerateError('ai_failed', false, undefined, monthlyFailures);
    expect(msg).toContain('Monthly token limit reached');
    expect(msg).toContain('shares this quota');
  });

  it('ai_failed without a quota failure keeps the generic provider advice', () => {
    const msg = mapRegenerateError('ai_failed', false, undefined, [
      { provider: 'openai', error: 'HTTP 500' },
    ]);
    expect(msg).toBe(
      'AI summary generation failed. Try another provider in AI settings, or wait a moment and try again.',
    );
  });
});
