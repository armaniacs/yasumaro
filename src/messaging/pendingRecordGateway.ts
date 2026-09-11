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

import { CURRENT_PROTOCOL_VERSION } from './protocol.js';

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
export const PENDING_RECORD_TIMEOUT_MS = 20000;

/** Sentinel error so callers can map the timeout to a localized message. */
export const PENDING_RECORD_TIMEOUT_ERROR = 'PENDING_RECORD_TIMEOUT';

export async function recordPendingPage(
  request: PendingRecordRequest,
  opts: { timeoutMs?: number } = {},
): Promise<PendingRecordResult> {
  const timeoutMs = opts.timeoutMs ?? PENDING_RECORD_TIMEOUT_MS;
  const payload: Record<string, unknown> = {
    title: request.title,
    url: request.url,
    content: request.content ?? '',
    force: request.force ?? true,
  };
  if (request.skipAi !== undefined) {
    payload.skipAi = request.skipAi;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = (await Promise.race([
      chrome.runtime.sendMessage({
        type: 'MANUAL_RECORD',
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        payload,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(PENDING_RECORD_TIMEOUT_ERROR)), timeoutMs);
      }),
    ])) as { success?: boolean; error?: string } | undefined;

    if (response?.success) {
      return { success: true };
    }
    return { success: false, error: response?.error ?? '' };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
