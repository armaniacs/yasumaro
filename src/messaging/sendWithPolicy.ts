/**
 * sendWithPolicy.ts — single seam for envelope + timeout + normalize.
 *
 * pendingRecordGateway and regenerateSummaryGateway hand-rolled the same
 * 3-step sequence (messageTransport.send inside withRuntimeTimeout, then a
 * try/catch that normalizes the response). Every new sender copied the trio
 * and the timeout contract (20s / 60s, retries off) scattered with it.
 *
 * This seam owns exactly that order and nothing else:
 * 1. The transport send stamps the protocol version and validates the
 *    envelope (retries default to SEND_POLICY_DEFAULT_RETRIES: extra attempts
 *    would extend past the documented timeout contract and stall under
 *    fake-timer tests);
 * 2. withRuntimeTimeout races the send against the caller's budget;
 * 3. try/catch normalizes — success raw via `normalize`, thrown errors
 *    (timeout sentinel included) via `mapError`, which defaults to the
 *    typed `SendFailure` shape both gateways already returned.
 */

import { errorMessage } from '../utils/errorUtils.js';
import { messageTransport, type MessageTransport } from './messageTransport.js';
import { SEND_POLICY_DEFAULT_RETRIES } from './sendRetryDefaults.js';
import { withRuntimeTimeout } from './withRuntimeTimeout.js';
import type { ExtensionMessage } from '../background/messageTypes.js';

type WithoutProtocolVersion<M> = M extends unknown ? Omit<M, 'protocolVersion'> : never;
type OutgoingMessage = WithoutProtocolVersion<ExtensionMessage>;

/**
 * Failure envelope the seam produces when the send throws (timeout sentinel
 * included) and the caller supplies no `mapError`. Declared as a named type
 * instead of cast to R (PBI 2026-10-20-11): every response contract routed
 * through this seam (PendingRecordResult, ResponseForType<'REGENERATE_SUMMARY'>)
 * accepts this shape, so the default failure is type-checked against each
 * gateway's response type at the gateway boundary — the sendWithPolicy return
 * widens to `R | SendFailure` and the old `as unknown as R` disappears.
 * Pinned by __tests__/sendWithPolicy.test.ts (type-level).
 */
export type SendFailure = { success: false; error: string };

export interface SendWithPolicyOptions<R extends { success: boolean }> {
  timeoutMs: number;
  timeoutError: Error;
  retries?: number;
  /**
   * Transport carrying the send. Defaults to the shared singleton; the
   * dashboard hop injects its own swappable transport so its raw send rides
   * this same seam (PBI 2026-10-24-06) instead of a parallel race.
   */
  transport?: MessageTransport;
  normalize: (raw: unknown) => R;
  mapError?: (error: unknown) => R | SendFailure;
}

function defaultMapError(error: unknown): SendFailure {
  return { success: false, error: errorMessage(error) };
}

export async function sendWithPolicy<M extends OutgoingMessage, R extends { success: boolean }>(
  msg: M,
  options: SendWithPolicyOptions<R>,
): Promise<R | SendFailure> {
  const {
    timeoutMs,
    timeoutError,
    retries = SEND_POLICY_DEFAULT_RETRIES,
    transport = messageTransport,
    normalize,
    mapError = defaultMapError,
  } = options;
  try {
    const raw = await withRuntimeTimeout(
      transport.send(msg, { retries }),
      timeoutMs,
      timeoutError,
    );
    return normalize(raw);
  } catch (error) {
    return mapError(error);
  }
}
