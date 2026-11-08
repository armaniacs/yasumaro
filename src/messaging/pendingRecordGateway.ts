/**
 * pendingRecordGateway.ts
 * Single owner of the "re-record a pending page" wire contract (PBI 2026-09-12-01).
 *
 * Three surfaces (popup privatePageDialog, popup pendingPages, dashboard
 * sqliteHistoryPanel) used to hand-roll the send. The dialog copy still sent a
 * dead `{type:'record'}` envelope that VALID_MESSAGE_TYPES never contained, so
 * every dialog save path failed silently; the dashboard copy was the only one
 * with a timeout. The envelope (MANUAL_RECORD + protocol version), the 20s
 * timeout contract, and response normalization now live behind one seam.
 *
 * Pending-storage lifecycle intentionally stays at each surface: the dialog
 * has no pending entry, pendingPages batch-removes after the loop, the panel
 * removes on success — forcing removal in here would change two surfaces'
 * behavior.
 */

import { RECORD_GATEWAY_TIMEOUT_MS, defineGateway } from './gatewayFactory.js';
import type { ManualRecordMessage } from '../background/messageTypes.js';

export interface PendingRecordRequest {
  title: string;
  url: string;
  content?: string;
  force?: boolean;
  skipAi?: boolean;
}

export interface PendingRecordResult {
  success: boolean;
  error?: string;
}

/** Timeout contract inherited from the dashboard pending panel. */
export const PENDING_RECORD_TIMEOUT_MS = RECORD_GATEWAY_TIMEOUT_MS;

/** Sentinel error so callers can map the timeout to a localized message. */
export const PENDING_RECORD_TIMEOUT_ERROR = 'PENDING_RECORD_TIMEOUT';

const pendingRecordGateway = defineGateway<
  'MANUAL_RECORD',
  ManualRecordMessage['payload'],
  PendingRecordResult
>({
  type: 'MANUAL_RECORD',
  timeoutMs: PENDING_RECORD_TIMEOUT_MS,
  timeoutError: PENDING_RECORD_TIMEOUT_ERROR,
  invalidMessage: 'Invalid PENDING_RECORD response',
});

export async function recordPendingPage(
  request: PendingRecordRequest,
  opts: { timeoutMs?: number } = {},
): Promise<PendingRecordResult> {
  const timeoutMs = opts.timeoutMs ?? PENDING_RECORD_TIMEOUT_MS;
  const payload: ManualRecordMessage['payload'] = {
    title: request.title,
    url: request.url,
    content: request.content ?? '',
    force: request.force ?? true,
  };
  if (request.skipAi !== undefined) {
    payload.skipAi = request.skipAi;
  }

  // The gateway's own timeout bounds the call; the seam adds version
  // stamping and validation inside that budget. Retries stay off: extra
  // attempts would extend past the documented timeout contract (and stall
  // under fake timers, which the timeout tests install).
  return pendingRecordGateway.send(payload, { timeoutMs });
}
