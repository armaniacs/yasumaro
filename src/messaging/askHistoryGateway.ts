/**
 * askHistoryGateway.ts — ASK_HISTORY sender (PBI 2026-10-23-08).
 *
 * Mirrors regenerateSummaryGateway's envelope + timeout + response
 * normalization, with the same 60s budget: this call includes the evidence
 * search plus the local AI round-trip (mode 'local_only' — on-device, but
 * still a full model pass).
 *
 * NOTE: a gateway timeout does NOT abort the SW handler — the handler
 * finishes and its own in-flight guard clears afterwards.
 */

import type { ResponseForType } from './types.js';
import { sendWithPolicy } from './sendWithPolicy.js';

export const ASK_HISTORY_TIMEOUT_MS = 60_000;
/** Sentinel so callers can map the timeout to a localized message. */
export const ASK_HISTORY_TIMEOUT_ERROR = 'Ask history request timed out';

export interface AskHistoryParams {
  question: string;
  collectionId?: string | null;
}

type AskHistoryResponse = ResponseForType<'ASK_HISTORY'>;

export async function askHistory(params: AskHistoryParams): Promise<AskHistoryResponse> {
  return sendWithPolicy(
    {
      type: 'ASK_HISTORY',
      payload: params,
    },
    {
      timeoutMs: ASK_HISTORY_TIMEOUT_MS,
      timeoutError: new Error(ASK_HISTORY_TIMEOUT_ERROR),
      retries: 0,
      normalize: normalizeAskHistoryResponse,
    },
  );
}

function normalizeAskHistoryResponse(raw: unknown): AskHistoryResponse {
  if (raw && typeof raw === 'object' && 'success' in raw && typeof (raw as { success: unknown }).success === 'boolean') {
    return raw as AskHistoryResponse;
  }
  return { success: false, error: 'Invalid ASK_HISTORY response' };
}
