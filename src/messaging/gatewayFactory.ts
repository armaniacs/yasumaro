/**
 * gatewayFactory.ts — declarative seam above sendWithPolicy (PBI 2026-11-07-09).
 *
 * askHistoryGateway, regenerateSummaryGateway, and pendingRecordGateway shared
 * the same envelope + timeout + normalize trio (their headers call each other
 * mirror images), each pinning its own timeout alias even though only two
 * budgets exist. This factory declares exactly the four varying bits —
 * `{ type, timeoutMs, timeoutError, invalidMessage }` — and owns the
 * `sendWithPolicy` + `asSuccessResponse` wiring, so each gateway keeps only
 * its payload building, export names, sentinel strings, and effective budget.
 *
 * Timeout budgets live here, one constant per purpose: the record path keeps
 * its 20s contract, the AI round-trip path (evidence search / tab load +
 * extraction + model pass) shares 60s. Gateways alias these under their
 * historic export names, so externally visible values never change.
 *
 * NOTE: a gateway timeout does NOT abort the SW handler — the handler
 * finishes on its own (same contract as before; this file only moves it).
 */

import { asSuccessResponse } from './normalizeGatewayResponse.js';
import { sendWithPolicy } from './sendWithPolicy.js';
import type { SendFailure } from './sendWithPolicy.js';
import type { OutgoingMessage } from './messageTransport.js';
export type { OutgoingMessage, WithoutProtocolVersion } from './messageTransport.js';

/** Record-path budget: pendingRecordGateway's 20s timeout contract. */
export const RECORD_GATEWAY_TIMEOUT_MS = 20_000;
/** AI round-trip budget shared by askHistory + regenerateSummary (60s). */
export const AI_GATEWAY_TIMEOUT_MS = 60_000;

export interface GatewayConfig<TType extends OutgoingMessage['type']> {
  type: TType;
  timeoutMs: number;
  timeoutError: string;
  invalidMessage: string;
}

export interface Gateway<P, R extends { success: boolean }> {
  readonly type: string;
  readonly timeoutMs: number;
  readonly timeoutError: string;
  readonly invalidMessage: string;
  send(payload: P, opts?: { timeoutMs?: number }): Promise<R | SendFailure>;
}

/**
 * Declare a gateway. The returned `send` stamps the envelope, races it
 * against the budget (per-call `opts.timeoutMs` overrides the default, so
 * recordPendingPage's override keeps working), and normalizes via
 * `asSuccessResponse` with the gateway's invalid-message sentence.
 * Retries stay off: extra attempts would extend past the documented timeout
 * contract (and stall under fake timers, which the timeout tests install).
 */
export function defineGateway<
  TType extends OutgoingMessage['type'],
  P,
  R extends { success: boolean },
>(config: GatewayConfig<TType>): Gateway<P, R> {
  const { type, timeoutMs: defaultTimeoutMs, timeoutError, invalidMessage } = config;
  return {
    type,
    timeoutMs: defaultTimeoutMs,
    timeoutError,
    invalidMessage,
    send(payload: P, opts: { timeoutMs?: number } = {}): Promise<R | SendFailure> {
      const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs;
      const message = { type, payload } as unknown as Extract<OutgoingMessage, { type: TType }>;
      return sendWithPolicy(message, {
        timeoutMs,
        timeoutError: new Error(timeoutError),
        retries: 0,
        normalize: (raw: unknown): R | SendFailure => asSuccessResponse<R>(raw, invalidMessage),
      });
    },
  };
}
