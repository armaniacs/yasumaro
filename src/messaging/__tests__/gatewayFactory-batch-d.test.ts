/**
 * gatewayFactory-batch-d.test.ts — PBI 2026-11-08-12 (items 1, 2) pins.
 *
 * (1) The payload generic is constrained to the wire payload for the
 * declared type, so a mismatched payload fails compilation (pinned with
 * @ts-expect-error — an unused directive fails type-check:test, so the
 * constraint is really enforced). The envelope construction uses a single
 * overlap-justified `as` instead of the old `as unknown as` double cast.
 * (2) The 20s/60s budgets are owned by sendRetryDefaults.ts; gatewayFactory
 * re-exports them under the historic names with identical values.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useTimerClock } from '../../../testDir/waitPolicy.js';
import {
  defineGateway,
  RECORD_GATEWAY_TIMEOUT_MS,
  AI_GATEWAY_TIMEOUT_MS,
} from '../gatewayFactory.js';
import {
  RECORD_GATEWAY_TIMEOUT_MS as DEFAULTS_RECORD_MS,
  AI_GATEWAY_TIMEOUT_MS as DEFAULTS_AI_MS,
  SEND_RETRY_DEFAULTS,
} from '../sendRetryDefaults.js';
import { CURRENT_PROTOCOL_VERSION } from '../protocol.js';

function stubSendMessage(impl: ReturnType<typeof vi.fn>): void {
  (globalThis as { chrome?: unknown }).chrome = { runtime: { sendMessage: impl } };
}

describe('gatewayFactory budgets (PBI 2026-11-08-12 item 2)', () => {
  it('keeps the 20s record and 60s AI budgets with unchanged values', () => {
    expect(RECORD_GATEWAY_TIMEOUT_MS).toBe(20_000);
    expect(AI_GATEWAY_TIMEOUT_MS).toBe(60_000);
  });

  it('re-exports the sendRetryDefaults single source of truth', () => {
    expect(RECORD_GATEWAY_TIMEOUT_MS).toBe(DEFAULTS_RECORD_MS);
    expect(AI_GATEWAY_TIMEOUT_MS).toBe(DEFAULTS_AI_MS);
    expect(SEND_RETRY_DEFAULTS.recordGatewayTimeoutMs).toBe(RECORD_GATEWAY_TIMEOUT_MS);
    expect(SEND_RETRY_DEFAULTS.aiGatewayTimeoutMs).toBe(AI_GATEWAY_TIMEOUT_MS);
  });
});

describe('defineGateway payload constraint (PBI 2026-11-08-12 item 1)', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it('sends the stamped envelope for a matching payload', async () => {
    useTimerClock();
    const sendMessage = vi.fn().mockResolvedValue({ success: true, answer: 'a' });
    stubSendMessage(sendMessage);

    const gateway = defineGateway<'ASK_HISTORY', { question: string; collectionId?: string | null }, { success: boolean }>({
      type: 'ASK_HISTORY',
      timeoutMs: AI_GATEWAY_TIMEOUT_MS,
      timeoutError: 'timed out',
      invalidMessage: 'Invalid ASK_HISTORY response',
    });
    await gateway.send({ question: 'q', collectionId: null });

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'ASK_HISTORY',
      payload: { question: 'q', collectionId: null },
      protocolVersion: CURRENT_PROTOCOL_VERSION,
    });
  });

  it('rejects a payload that does not match the declared type at compile time', () => {
    const config = {
      type: 'ASK_HISTORY',
      timeoutMs: AI_GATEWAY_TIMEOUT_MS,
      timeoutError: 'timed out',
      invalidMessage: 'Invalid ASK_HISTORY response',
    } as const;
    const gateway = defineGateway<'ASK_HISTORY', { question: string; collectionId?: string | null }, { success: boolean }>(config);
    expect(gateway.timeoutMs).toBe(AI_GATEWAY_TIMEOUT_MS);
    // The mismatch below must stay a compile error (an unused @ts-expect-error
    // fails type-check:test, which is exactly the pin): a numeric question is
    // not the ASK_HISTORY wire payload.
    // @ts-expect-error a numeric question is not the ASK_HISTORY wire payload
    defineGateway<'ASK_HISTORY', { question: number }, { success: boolean }>(config);
  });
});
