/**
 * normalizeGatewayResponse.ts — shared response guard for message gateways.
 *
 * askHistoryGateway, researchReportGateway and regenerateSummaryGateway each
 * hand-rolled the same five-line shape check before delegating to
 * sendWithPolicy (PBI 2026-10-23-03): the next gateway would have copied a
 * fourth variant and the RESEARCH_REPORT copy already drifted to a reused
 * timeout sentence. This module owns the single definition of "well-formed"
 * (a boolean `success` flag) so each gateway normalize shrinks to a one-line
 * delegation that only pins its own failure sentence.
 */

import type { SendFailure } from './sendWithPolicy.js';

/**
 * Return the raw payload untouched when it carries a boolean `success`
 * flag, otherwise the failure envelope with the caller's pinned sentence.
 * The failure sentence is owned by the caller on purpose: RESEARCH_REPORT
 * reuses its timeout sentence and that wording is pinned by tests, so this
 * helper must not normalize sentences across gateways.
 */
export function asSuccessResponse<R extends { success: boolean }>(
  raw: unknown,
  invalidError: string,
): R | SendFailure {
  if (
    raw &&
    typeof raw === 'object' &&
    'success' in raw &&
    typeof (raw as { success: boolean }).success === 'boolean'
  ) {
    return raw as R;
  }
  return { success: false, error: invalidError };
}
