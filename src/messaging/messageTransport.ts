/**
 * messageTransport.ts
 * PBI-22: Unified MessageTransport — single seam for chrome.runtime.sendMessage
 * Combines typed ExtensionMessage + CURRENT_PROTOCOL_VERSION + MessageValidator + RetryPolicy.
 */

import { CURRENT_PROTOCOL_VERSION } from './protocol.js';
import type { ExtensionMessage } from '../background/messageTypes.js';
import { VALID_MESSAGE_TYPES } from '../background/messageTypes.js';
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

function isRetryableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return RETRYABLE_ERROR_PATTERNS.some((p) => p.test(msg));
}

export interface MessageTransportOptions {
  retries?: number;
  clock?: { now: () => number; sleep: (ms: number) => Promise<void> };
}

const defaultClock: { now: () => number; sleep: (ms: number) => Promise<void> } = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

export class MessageTransport {
  constructor(
    private port: TransportPort = new ChromeTransport(),
    private clock: { now: () => number; sleep: (ms: number) => Promise<void> } = defaultClock,
  ) {}

  async send<T extends ExtensionMessage>(message: T, opts: MessageTransportOptions = {}): Promise<unknown> {
    const retries = opts.retries ?? 3;
    const clock = opts.clock ?? this.clock;

    // Attach protocol version and validate
    const enriched = { ...message, protocolVersion: CURRENT_PROTOCOL_VERSION } as T & { protocolVersion: number };
    if (!VALID_MESSAGE_TYPES.includes(enriched.type as never)) {
      throw new Error(`Invalid message type: ${String((enriched as Record<string, unknown>).type)}`);
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await this.port.send(enriched);
        // Check chrome.runtime.lastError polling (for callback-based callers that use sendMessageWithCallback)
        const lastErrorMsg = (chrome.runtime as unknown as { lastError?: { message?: string } }).lastError?.message;
        if (lastErrorMsg && isRetryableError(lastErrorMsg)) {
          throw new Error(lastErrorMsg);
        }
        return response;
      } catch (error) {
        lastError = error;
        if (attempt < retries && isRetryableError(error)) {
          const delayMs = Math.min(100 * Math.pow(2, attempt), 1000);
          await clock.sleep(delayMs);
          continue;
        }
        throw error;
      }
    }
    throw lastError ?? new Error('Message send failed after retries');
  }
}

export const messageTransport = new MessageTransport();
