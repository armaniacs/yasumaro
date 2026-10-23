/**
 * regenerateSummaryGateway.ts — REGENERATE_SUMMARY sender (PBI 2026-09-22-04).
 *
 * Mirrors pendingRecordGateway's envelope + timeout + response normalization,
 * with a 60s budget (REGENERATE_TIMEOUT_MS) instead of the 20s record gate:
 * this call includes tab load + extraction + the AI round-trip.
 *
 * NOTE: a gateway timeout does NOT abort the SW pipeline — the handler
 * finishes and may still UPDATE the row (idempotent same-row write; Why 連鎖H).
 */

import type { ResponseForType } from './types.js';
import type { RegenerateCleanseMode } from '../utils/aiSummaryCleaner/cleanseModeLadder.js';
import { asSuccessResponse } from './normalizeGatewayResponse.js';
import { sendWithPolicy } from './sendWithPolicy.js';
import type { SendFailure } from './sendWithPolicy.js';

export const REGENERATE_TIMEOUT_MS = 60_000;
/** Sentinel so callers can map the timeout to a localized message. */
export const REGENERATE_TIMEOUT_ERROR = 'Regenerate summary request timed out';

export interface RegenerateSummaryParams {
  id: number;
  url: string;
  title: string;
  cleanseMode: RegenerateCleanseMode;
  force?: boolean;
}

type RegenerateSummaryResponse = ResponseForType<'REGENERATE_SUMMARY'>;

export async function regenerateSummary(
  params: RegenerateSummaryParams,
): Promise<RegenerateSummaryResponse | SendFailure> {
  return sendWithPolicy(
    // Own timeout bounds the call; the seam adds version stamping and
    // validation inside that budget. Retries stay off for the same reason
    // as pendingRecordGateway (documented timeout contract + fake timers).
    {
      type: 'REGENERATE_SUMMARY',
      payload: params,
    },
    {
      timeoutMs: REGENERATE_TIMEOUT_MS,
      timeoutError: new Error(REGENERATE_TIMEOUT_ERROR),
      retries: 0,
      normalize: normalizeRegenerateResponse,
    },
  );
}

function normalizeRegenerateResponse(raw: unknown): RegenerateSummaryResponse | SendFailure {
  return asSuccessResponse<RegenerateSummaryResponse>(raw, 'Invalid REGENERATE_SUMMARY response');
}
