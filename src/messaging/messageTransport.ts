/**
 * messageTransport.ts
 * PBI-22: Unified MessageTransport — single seam for chrome.runtime.sendMessage
 * Combines typed ExtensionMessage + CURRENT_PROTOCOL_VERSION + MessageValidator + RetryPolicy.
 */

import { CURRENT_PROTOCOL_VERSION } from './protocol.js';
import type { ExtensionMessage } from '../background/messageTypes.js';
import { VALID_MESSAGE_TYPES } from '../background/messageTypes.js';
import { backoffDelayMs } from '../utils/backoff.js';
import { errorMessage } from '../utils/errorUtils.js';

export interface TransportPort {
  send(message: unknown): Promise<unknown>;
}

export class ChromeTransport implements TransportPort {
  async send(message: unknown): Promise<unknown> {
    return chrome.runtime.sendMessage(message);
  }
}

export class ImmediateTransport implements TransportPort {
  constructor(private handler: (msg: unknown) => Promise<unknown>) {}
  async send(message: unknown): Promise<unknown> {
    return this.handler(message);
  }
}

const RETRYABLE_ERROR_PATTERNS = [
  /Receiving end does not exist/i,
  /Could not establish connection/i,
  /The message port closed/i,
  /Extension context invalidated/i,
];

/**
 * Canonical transport-level retriability predicate (PBI 2026-09-28-29).
 *
 * Scope: message-transport failures only (dead port, torn-down context).
 * Network-fetch failures (pipeline/retryPolicy.ts LEGACY_NETWORK_MARKERS)
 * and provider HTTP failures (ProviderStrategy.shouldRetrySummaryRequest)
 * are different error universes with their own policies — they cross-link
 * here for the transport class instead of merging into one function.
 */
export function isRetryableError(error: unknown): boolean {
  const msg = errorMessage(error);
  return RETRYABLE_ERROR_PATTERNS.some((p) => p.test(msg));
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
type WithoutProtocolVersion<M> = M extends unknown ? Omit<M, 'protocolVersion'> : never;
type OutgoingMessage = WithoutProtocolVersion<ExtensionMessage>;

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
    const retries = opts.retries ?? 3;
    const clock = opts.clock ?? this.clock;

    // Attach protocol version and validate
    const enriched = { ...message, protocolVersion: CURRENT_PROTOCOL_VERSION } as M & { protocolVersion: number };
    if (!VALID_MESSAGE_TYPES.includes(enriched.type as never)) {
      throw new Error(`Invalid message type: ${String((enriched as Record<string, unknown>).type)}`);
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
          const delayMs = backoffDelayMs(attempt, { baseMs: 100, multiplier: 2, maxMs: 1000 });
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
