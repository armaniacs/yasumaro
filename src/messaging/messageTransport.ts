/**
 * messageTransport.ts
 * PBI-22: Unified MessageTransport — single seam for chrome.runtime.sendMessage
 * Combines typed ExtensionMessage + CURRENT_PROTOCOL_VERSION + MessageValidator + RetryPolicy.
 */

import { CURRENT_PROTOCOL_VERSION } from './protocol.js';
import type { ExtensionMessage } from '../background/messageTypes.js';
import { isKnownMessageType, isValidEnvelopeShape } from './envelopeShape.js';
import { backoffDelayMs } from '../utils/backoff.js';
import { errorMessage } from '../utils/errorUtils.js';
import {
  TRANSPORT_DEFAULT_RETRIES,
  TRANSPORT_RETRY_BASE_MS,
  TRANSPORT_RETRY_MAX_MS,
  TRANSPORT_RETRY_MULTIPLIER,
} from './sendRetryDefaults.js';

export interface TransportPort {
  send(message: unknown): Promise<unknown>;
}

export class ChromeTransport implements TransportPort {
  async send(message: unknown): Promise<unknown> {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      throw toTransportError(error);
    }
  }
}

export class ImmediateTransport implements TransportPort {
  constructor(private handler: (msg: unknown) => Promise<unknown>) {}
  async send(message: unknown): Promise<unknown> {
    return this.handler(message);
  }
}

/**
 * Machine-readable marker for transport-level retriability (PBI
 * 2026-11-08-17: the retry policy used to read English error sentences with
 * regular expressions, so any Chrome wording change silently flipped the
 * retry decision. The decision below reads only this code, so reworded
 * messages with the same code retry exactly as before).
 */
export const TRANSPORT_RETRYABLE_CODE = 'message-transport/retryable';

/**
 * A transport failure the sender may retry (dead port, torn-down context).
 * Ports throw this instead of a bare Error so `isRetryableError` never
 * inspects message wording. The original failure stays available as
 * `cause`.
 */
export class RetryableTransportError extends Error {
  readonly code = TRANSPORT_RETRYABLE_CODE;
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RetryableTransportError';
  }
}

/**
 * Read the machine-readable retry code off any thrown value. Codeless
 * values (plain Errors, strings, Chrome's foreign rejections) yield null —
 * never retryable by code.
 */
function transportErrorCodeOf(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code: unknown = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

/**
 * Foreign-error seam for the Chrome boundary (PBI 2026-11-08-17):
 * `chrome.runtime.sendMessage` rejects with plain Errors whose only signal
 * is Chrome's English wording, so this translator — and only this
 * translator — still matches that wording, once, at the boundary where the
 * foreign error enters. Everything downstream (the policy below, the retry
 * loop) reads only the attached code.
 */
const CHROME_TRANSIENT_MESSAGE_PATTERNS = [
  /Receiving end does not exist/i,
  /Could not establish connection/i,
  /The message port closed/i,
  /Extension context invalidated/i,
];

function toTransportError(error: unknown): unknown {
  if (isRetryableError(error)) return error;
  if (CHROME_TRANSIENT_MESSAGE_PATTERNS.some((p) => p.test(errorMessage(error)))) {
    return new RetryableTransportError(errorMessage(error), { cause: error });
  }
  return error;
}

/**
 * Canonical transport-level retriability predicate (PBI 2026-09-28-29,
 * code-based since PBI 2026-11-08-17).
 *
 * Scope: message-transport failures only (dead port, torn-down context).
 * Network-fetch failures (pipeline/retryPolicy.ts LEGACY_NETWORK_MARKERS)
 * and provider HTTP failures (ProviderStrategy.shouldRetrySummaryRequest)
 * are different error universes with their own policies — they cross-link
 * here for the transport class instead of merging into one function.
 *
 * Code-based: only errors carrying TRANSPORT_RETRYABLE_CODE retry. Plain
 * Errors retry nothing even when their message sounds transient — wording
 * is not a contract. Chrome's foreign rejections gain the code in
 * ChromeTransport (toTransportError); test and custom ports attach it
 * themselves (RetryableTransportError or any `{ code }` carrier).
 */
export function isRetryableError(error: unknown): boolean {
  return transportErrorCodeOf(error) === TRANSPORT_RETRYABLE_CODE;
}

export interface MessageTransportOptions {
  retries?: number;
  clock?: { now: () => number; sleep: (ms: number) => Promise<void> };
}

/**
 * What a caller hands to send(): the wire contract minus `protocolVersion`.
 *
 * Senders must not stamp the version themselves — send() does it for every
 * message — so requiring `protocolVersion` in the parameter is what pushed
 * callers into casting their envelopes through `ExtensionMessage`. The
 * conditional distributes over the union so each envelope keeps its `type`
 * discriminant.
 */
export type WithoutProtocolVersion<M> = M extends unknown ? Omit<M, 'protocolVersion'> : never;
export type OutgoingMessage = WithoutProtocolVersion<ExtensionMessage>;

const defaultClock: { now: () => number; sleep: (ms: number) => Promise<void> } = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

export class MessageTransport {
  constructor(
    private port: TransportPort = new ChromeTransport(),
    private clock: { now: () => number; sleep: (ms: number) => Promise<void> } = defaultClock,
  ) {}

  async send<M extends OutgoingMessage>(message: M, opts: MessageTransportOptions = {}): Promise<unknown> {
    const retries = opts.retries ?? TRANSPORT_DEFAULT_RETRIES;
    const clock = opts.clock ?? this.clock;

    // Attach protocol version and validate the full envelope shape
    // (PBI 2026-11-08-12): the old gate checked only `type`, so a known
    // type with a missing or malformed payload travelled to the port
    // unexamined. The payload branch rules stay in envelopeShape —
    // per-field content checks stay in the per-type validators.
    const enriched = { ...message, protocolVersion: CURRENT_PROTOCOL_VERSION };
    if (!isKnownMessageType(enriched.type)) {
      throw new Error(`Invalid message type: ${String(enriched.type)}`);
    }
    if (!isValidEnvelopeShape(enriched)) {
      throw new Error(`Invalid message payload for type: ${String(enriched.type)}`);
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // Promise-style sendMessage never populates chrome.runtime.lastError
        // (callback-only API); failures surface as rejections and are retried
        // below by pattern.
        return await this.port.send(enriched);
      } catch (error) {
        lastError = error;
        if (attempt < retries && isRetryableError(error)) {
          const delayMs = backoffDelayMs(attempt, {
            baseMs: TRANSPORT_RETRY_BASE_MS,
            multiplier: TRANSPORT_RETRY_MULTIPLIER,
            maxMs: TRANSPORT_RETRY_MAX_MS,
          });
          await clock.sleep(delayMs);
          continue;
        }
        throw error;
      }
    }
    throw lastError ?? new Error('Message send failed after retries');
  }
}

/**
 * Stateless convenience singleton: MessageTransport holds no SW-lifetime state
 * (transport and clock are constructor-injected for tests), so a shared
 * instance needs neither container registration nor restart handling.
 * See dev-docs/ADR/2026-09-17-module-singleton-policy.md.
 */
export const messageTransport = new MessageTransport();
