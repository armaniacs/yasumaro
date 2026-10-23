import { tOrKey as t } from '../../../utils/i18n.js';
import { PENDING_RECORD_TIMEOUT_ERROR } from '../../../messaging/pendingRecordGateway.js';
import { REGENERATE_TIMEOUT_ERROR } from '../../../messaging/regenerateSummaryGateway.js';
import type { SendFailure } from '../../../messaging/sendWithPolicy.js';
import type { RegenerateSummaryResponse } from '../../../messaging/types.js';

/** Single slot failure row shown in the error detail trail. */
export interface SlotFailureRecord {
  provider: string;
  error: string;
}

/** Display bundle derived from one gateway response: message, optional detail, gate flag. */
export interface RegenerateErrorDisplay {
  message: string;
  detail?: string;
  needsForce: boolean;
}

/** Element guard shared by the detail builder, the monthly-limit check, and the response filter below. */
export function isSlotFailureRecord(value: unknown): value is SlotFailureRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    'provider' in value &&
    'error' in value &&
    typeof value.provider === 'string' &&
    typeof value.error === 'string'
  );
}

/**
 * Build the multi-line error-row detail: providers tried in order, then each
 * slot's own failure text (PBI 2026-09-22-04 follow-up — the old single-error
 * display could only ever show the LAST slot's message, e.g. built-in-ai's
 * kErrorUnknown, masking why openai/gemini failed). Pure for unit tests.
 */
export function formatRegenerateErrorDetail(
  attemptedProviders: string[],
  slotFailures: ReadonlyArray<SlotFailureRecord> | undefined,
  triedLabel: string,
): string | undefined {
  const lines: string[] = [];
  if (attemptedProviders.length > 0) {
    lines.push(`${triedLabel}: ${attemptedProviders.join(' → ')}`);
  }
  for (const f of slotFailures ?? []) {
    if (!isSlotFailureRecord(f)) continue;
    lines.push(`${f.provider}: ${f.error}`);
  }
  return lines.length > 0 ? lines.join('\n') : undefined;
}

/**
 * Sentinel → i18n key mapping for REGENERATE_SUMMARY failures (PBI
 * 2026-09-22-04). Exported as a pure module-level function so unit tests can
 * pin the matrix directly; raw handler strings are never rendered — unknown
 * sentinels collapse to the generic key and Error-prefixed strings pass
 * through unchanged (same contract as translateHistoryError).
 */
export function mapRegenerateError(
  error: string | undefined,
  needsForce: boolean,
  reason?: string,
  slotFailures?: ReadonlyArray<SlotFailureRecord>,
): string {
  if (needsForce) return t('historyRegenerateGateBlocked');
  // The handler threads reason:'rate_limited'; match it first so the raw
  // RateLimiter message (capital 'Rate limit…') never needs case gymnastics.
  // PBI 03: consent rejections thread reason:'privacy_consent_required' (the
  // unified admission shape) — matched before the error-based checks.
  if (reason === 'rate_limited') return t('historyRegenerateErrorRateLimit');
  if (reason === 'privacy_consent_required') return t('historyRegenerateErrorConsent');
  if (!error) return t('historyRegenerateError');
  if (error === 'invalid_url') return t('historyRegenerateErrorUrl');
  if (error === 'rate_limited' || /rate limit/i.test(error)) return t('historyRegenerateErrorRateLimit');
  if (error.startsWith('fetch_failed')) return t('historyRegenerateErrorFetch');
  if (error === REGENERATE_TIMEOUT_ERROR || error === PENDING_RECORD_TIMEOUT_ERROR) return t('historyRegenerateErrorTimeout');
  if (error === 'privacy_consent_required') return t('historyRegenerateErrorConsent');
  if (error === 'ai_failed' || error.startsWith('ai_failed:')) {
    // The monthly token quota is SHARED by every HTTP provider (one counter
    // in aiUsageTracker) — when it tripped, "try another provider" advice is
    // wrong: the next HTTP slot hits the same wall. Show the actionable
    // message instead; the per-slot detail rows still explain each failure.
    if (slotFailures?.some((f) => isSlotFailureRecord(f) && f.error.includes('Monthly token limit'))) {
      return t('historyRegenerateErrorMonthlyLimit');
    }
    return t('historyRegenerateErrorAi');
  }
  if (error.startsWith('Error:')) return error;
  return t('historyRegenerateError');
}

/**
 * Single entry point for gateway-response → display-detail conversion (PBI
 * 2026-10-24-03). Owns the response-only field narrowing that used to live
 * inline in the panel caller, so malformed elements are filtered in exactly
 * one place: non-string providers are dropped, non-record slot failures are
 * dropped. At runtime a SendFailure never carries these keys, so each guard
 * evaluates exactly as the direct access it replaces.
 */
export function toRegenerateErrorDisplay(
  result: RegenerateSummaryResponse | SendFailure,
  triedLabel: string,
): RegenerateErrorDisplay {
  const needsForce = 'needsForce' in result && result.needsForce === true;
  const attemptedProviders =
    'attemptedProviders' in result && Array.isArray(result.attemptedProviders)
      ? result.attemptedProviders.filter((p): p is string => typeof p === 'string')
      : [];
  const slotFailures =
    'slotFailures' in result && Array.isArray(result.slotFailures)
      ? result.slotFailures.filter((f): f is SlotFailureRecord => isSlotFailureRecord(f))
      : undefined;
  const detail = formatRegenerateErrorDetail(attemptedProviders, slotFailures, triedLabel);
  const message = mapRegenerateError(
    result.error,
    needsForce,
    'reason' in result ? result.reason : undefined,
    slotFailures,
  );
  if (detail === undefined) {
    return { message, needsForce };
  }
  return { message, detail, needsForce };
}
