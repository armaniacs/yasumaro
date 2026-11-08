/**
 * normalizeGatewayResponse.ts — shared response guard for message gateways.
 *
 * askHistoryGateway, researchReportGateway and regenerateSummaryGateway each
 * hand-rolled the same five-line shape check before delegating to
 * sendWithPolicy (PBI 2026-10-23-03): the next gateway would have copied a
 * fourth variant and the RESEARCH_REPORT copy already drifted to a reused
 * timeout sentence. This module owns the single definition of "well-formed"
 * (a boolean `success` flag, plus a non-blank string `error` on failures
 * and never an array) so each gateway normalize shrinks to a one-line
 * delegation that only pins its own failure sentence.
 */

import type { SendFailure } from './sendWithPolicy.js';

/**
 * Extra-field policy (PBI 2026-11-08-12): the minimal shape check above
 * cannot judge fields beyond `success` / `error`, but they no longer pass
 * silently.
 *
 * - Failure envelopes (`success: false`) have a fully known shape, so any
 *   key beyond `success`/`error` is reported through `onExtraFields`.
 *   The fields themselves are PRESERVED, not stripped: downstream display
 *   narrowing (`toRegenerateErrorDisplay`) reads optional members
 *   (`needsForce`, `attemptedProviders`, `slotFailures`, `reason`) via `in`
 *   checks, and stripping them would break the gate UI.
 * - Success envelopes keep R's full shape by reference (R is caller-owned
 *   and this seam cannot enumerate it); the hook does not fire for them.
 */
export type ExtraFieldsReport = (extraKeys: string[]) => void;

/**
 * Return the raw payload untouched when it carries a boolean `success`
 * flag, otherwise the failure envelope with the caller's pinned sentence.
 * A `success === false` payload additionally needs a non-empty string
 * `error`: bare failures (`{ success: false }`), blank errors, and
 * non-string errors are worker-side shape breaks, so they map to the
 * caller's sentence instead of reaching the panel as an empty display.
 * Arrays never pass, even with an injected `success` property.
 * The failure sentence is owned by the caller on purpose: RESEARCH_REPORT
 * reuses its timeout sentence and that wording is pinned by tests, so this
 * helper must not normalize sentences across gateways.
 */
export function asSuccessResponse<R extends { success: boolean }>(
  raw: unknown,
  invalidError: string,
  onExtraFields?: ExtraFieldsReport,
): R | SendFailure {
  if (
    raw &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    'success' in raw &&
    typeof (raw as { success: boolean }).success === 'boolean'
  ) {
    const candidate = raw as { success: boolean; error?: string };
    if (candidate.success === false) {
      if (typeof candidate.error !== 'string' || candidate.error.trim().length === 0) {
        return { success: false, error: invalidError };
      }
      const extraKeys = Object.keys(candidate).filter((key) => key !== 'success' && key !== 'error');
      if (extraKeys.length > 0) onExtraFields?.(extraKeys);
    }
    return raw as R;
  }
  return { success: false, error: invalidError };
}
