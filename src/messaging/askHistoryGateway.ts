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
import { AI_GATEWAY_TIMEOUT_MS, defineGateway } from './gatewayFactory.js';
import type { SendFailure } from './sendWithPolicy.js';

export const ASK_HISTORY_TIMEOUT_MS = AI_GATEWAY_TIMEOUT_MS;
/** Sentinel so callers can map the timeout to a localized message. */
export const ASK_HISTORY_TIMEOUT_ERROR = 'Ask history request timed out';

export interface AskHistoryParams {
  question: string;
  collectionId?: string | null;
}

type AskHistoryResponse = ResponseForType<'ASK_HISTORY'>;

const askHistoryGateway = defineGateway<'ASK_HISTORY', AskHistoryParams, AskHistoryResponse>({
  type: 'ASK_HISTORY',
  timeoutMs: ASK_HISTORY_TIMEOUT_MS,
  timeoutError: ASK_HISTORY_TIMEOUT_ERROR,
  invalidMessage: 'Invalid ASK_HISTORY response',
});

export async function askHistory(params: AskHistoryParams): Promise<AskHistoryResponse | SendFailure> {
  return askHistoryGateway.send(params);
}
