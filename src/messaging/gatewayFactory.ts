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

import { backoffDelayMs } from '../utils/backoff.js';
import { errorMessage } from '../utils/errorUtils.js';
import { asSuccessResponse } from './normalizeGatewayResponse.js';
import { withRuntimeTimeout } from './withRuntimeTimeout.js';
import {
  AI_GATEWAY_TIMEOUT_MS,
  DASHBOARD_GATEWAY_RETRY_ATTEMPTS,
  DASHBOARD_GATEWAY_RETRY_DELAY_MS,
  DASHBOARD_GATEWAY_RETRY_MULTIPLIER,
  DASHBOARD_INNER_TRANSPORT_RETRIES,
  DASHBOARD_SQLITE_TIMEOUT_MESSAGE,
  DASHBOARD_SQLITE_TIMEOUT_MS,
  RECORD_GATEWAY_TIMEOUT_MS,
} from './sendRetryDefaults.js';
import { sendWithPolicy } from './sendWithPolicy.js';
import type { SendFailure } from './sendWithPolicy.js';
import type { OutgoingMessage } from './messageTransport.js';
export type { OutgoingMessage, WithoutProtocolVersion } from './messageTransport.js';

/**
 * Gateway timeout budgets live in sendRetryDefaults.ts (PBI 2026-11-08-12:
 * the 20s/60s budgets were defined here beside the other send/retry
 * numbers). Re-exported under the historic names so gateway modules keep
 * their existing imports and externally visible values never change.
 * PBI 2026-11-20-04: the dashboard hop budgets join this table so every
 * gateway budget is declared in one place; the values are unchanged.
 */
export {
  AI_GATEWAY_TIMEOUT_MS,
  RECORD_GATEWAY_TIMEOUT_MS,
  DASHBOARD_GATEWAY_RETRY_ATTEMPTS,
  DASHBOARD_GATEWAY_RETRY_DELAY_MS,
  DASHBOARD_GATEWAY_RETRY_MULTIPLIER,
  DASHBOARD_INNER_TRANSPORT_RETRIES,
  DASHBOARD_SQLITE_TIMEOUT_MESSAGE,
  DASHBOARD_SQLITE_TIMEOUT_MS,
};

/**
 * Pre-send hook: transforms the payload right before it crosses the seam
 * (PBI 2026-11-20-04). The dashboard hop attaches its confirmToken this way
 * instead of wrapping the send in gateway-specific code.
 */
export type PreSendHook<P> = (payload: P) => Promise<P>;

/**
 * Retry policy passed to the shared runner (PBI 2026-11-20-04). Gateways
 * declare attempts/delay here instead of owning a private retry loop; the
 * runner below owns the loop and the inter-attempt wait.
 */
export interface GatewayRetryPolicy {
  attempts: number;
  delayMs: number;
  multiplier: number;
  sleep: (ms: number) => Promise<void>;
}

export type RetryAttemptOutcome<R> =
  | { action: 'return'; result: R }
  | { action: 'retry' };

/**
 * Run one policy-driven retry series. The attempt callback decides per
 * attempt whether its result is final or deserves another try (seeing
 * `isLast` so the final attempt always produces a result); this runner
 * owns the loop and the backoff wait between attempts. Decode-style
 * failures stay non-retriable by returning instead of retrying.
 */
export async function runWithRetryPolicy<R>(
  policy: GatewayRetryPolicy,
  attempt: (isLast: boolean) => Promise<RetryAttemptOutcome<R>>,
  onExhausted: () => R,
): Promise<R> {
  for (let index = 0; index < policy.attempts; index++) {
    const isLast = index + 1 >= policy.attempts;
    const outcome = await attempt(isLast);
    if (outcome.action === 'return') return outcome.result;
    if (!isLast) {
      await policy.sleep(backoffDelayMs(index, { baseMs: policy.delayMs, multiplier: policy.multiplier }));
    }
  }
  return onExhausted();
}

export interface GatewayConfig<TType extends OutgoingMessage['type']> {
  type: TType;
  timeoutMs: number;
  timeoutError: string;
  invalidMessage: string;
  /**
   * Optional pre-send hook (PBI 2026-11-20-04). Absent by default, so
   * gateways that declare no hook keep their exact current behavior.
   */
  preSend?: PreSendHook<GatewayPayload<TType>>;
}

/**
 * Wire payload for one outgoing message type (PBI 2026-11-08-12). A
 * mapped lookup instead of `Extract<...>[...]` indexing: indexing a
 * deferred Extract with a generic key is rejected (TS2536), while a
 * generic key into this concrete table resolves fine. Payload-less types
 * map to never — every declared gateway carries a payload.
 */
export type GatewayPayload<TType extends OutgoingMessage['type']> = {
  [M in OutgoingMessage as M['type']]: M extends { payload: infer P } ? P : never;
}[TType];

export interface Gateway<P, R extends { success: boolean }> {
  readonly type: string;
  readonly timeoutMs: number;
  readonly timeoutError: string;
  readonly invalidMessage: string;
  readonly preSend?: PreSendHook<P>;
  send(payload: P, opts?: { timeoutMs?: number }): Promise<R | SendFailure>;
}

/**
 * Declare a gateway. The returned `send` runs the optional `preSend` hook,
 * stamps the envelope, races it against the budget (per-call
 * `opts.timeoutMs` overrides the default, so recordPendingPage's override
 * keeps working), and normalizes via `asSuccessResponse` with the gateway's
 * invalid-message sentence.
 * Retries stay off: extra attempts would extend past the documented timeout
 * contract (and stall under fake timers, which the timeout tests install).
 *
 * Type safety (PBI 2026-11-08-12): `P` is constrained to the wire payload
 * for `TType`, so a payload that does not match the declared message type
 * fails compilation instead of crossing the seam. The single `as` below is
 * then overlap-justified by that constraint — the old `as unknown as`
 * double cast erased the mismatch instead of proving it away.
 */
export function defineGateway<
  TType extends OutgoingMessage['type'],
  P extends GatewayPayload<TType>,
  R extends { success: boolean },
>(config: GatewayConfig<TType>): Gateway<P, R> {
  const { type, timeoutMs: defaultTimeoutMs, timeoutError, invalidMessage, preSend } = config;
  // Bridge the config hook (wide wire payload) to this gateway's payload.
  // The hook transforms and returns the same payload object, so the result
  // cast is overlap-justified by the P-extends-wire-payload constraint; the
  // wrapper itself needs no cast. Omit the key entirely when no hook is
  // given, so the gateway shape is identical to the pre-hook era
  // (exactOptionalPropertyTypes forbids an explicit undefined here).
  const asPreSend = preSend
    ? async (payload: P): Promise<P> => preSend(payload) as Promise<P>
    : undefined;
  return {
    type,
    timeoutMs: defaultTimeoutMs,
    timeoutError,
    invalidMessage,
    ...(asPreSend ? { preSend: asPreSend } : {}),
    async send(payload: P, opts: { timeoutMs?: number } = {}): Promise<R | SendFailure> {
      const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs;
      let effective = payload;
      if (preSend) {
        try {
          effective = (await withRuntimeTimeout(
            preSend(payload as GatewayPayload<TType>),
            timeoutMs,
            new Error(timeoutError),
          )) as unknown as P;
        } catch (error) {
          return { success: false, error: errorMessage(error) };
        }
      }
      const message = { type, payload: effective } as Extract<OutgoingMessage, { type: TType }>;
      return sendWithPolicy(message, {
        timeoutMs,
        timeoutError: new Error(timeoutError),
        retries: 0,
        normalize: (raw: unknown): R | SendFailure => asSuccessResponse<R>(raw, invalidMessage),
      });
    },
  };
}
