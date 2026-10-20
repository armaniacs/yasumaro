/**
 * sendWithPolicy.test.ts — seam contract (PBI 2026-10-14-02).
 * Pins that the timeout wording survives via the sentinel: a send that never
 * settles must resolve to `{ success: false, error: <sentinel> }`, never hang
 * and never leak the raw timer error. Follows pendingRecordGateway.test.ts:
 * fake clock + advanceTimersByTimeAsync, no real-time waits.
 */
import { describe, it, expect, expectTypeOf, vi, beforeEach, afterEach } from 'vitest';
import { useTimerClock } from '../../../testDir/waitPolicy.js';
import { sendWithPolicy } from '../sendWithPolicy.js';
import type { SendFailure } from '../sendWithPolicy.js';
import type { PendingRecordResult } from '../pendingRecordGateway.js';
import type { ResponseForType } from '../types.js';
import { CURRENT_PROTOCOL_VERSION } from '../protocol.js';

interface ProbeResult {
  success: boolean;
  error?: string;
}

function stubSendMessage(impl: ReturnType<typeof vi.fn>): void {
  (globalThis as { chrome?: unknown }).chrome = { runtime: { sendMessage: impl } };
}

const MANUAL_MSG = {
  type: 'MANUAL_RECORD',
  payload: { title: 'T', url: 'https://example.com', content: '', force: true },
} as const;

describe('sendWithPolicy', () => {
  beforeEach(() => useTimerClock());
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it('resolves the timeout sentinel message when the send never settles', async () => {
    stubSendMessage(vi.fn().mockReturnValue(new Promise(() => undefined)));
    const normalize = vi.fn((_raw: unknown): ProbeResult => ({ success: true }));

    const pending = sendWithPolicy(MANUAL_MSG, {
      timeoutMs: 20000,
      timeoutError: new Error('PENDING_RECORD_TIMEOUT'),
      retries: 0,
      normalize,
    });
    await vi.advanceTimersByTimeAsync(20000);

    await expect(pending).resolves.toEqual({ success: false, error: 'PENDING_RECORD_TIMEOUT' });
    expect(normalize).not.toHaveBeenCalled();
  });

  it('stamps the protocol version and returns the normalized success', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ success: true });
    stubSendMessage(sendMessage);

    const result = await sendWithPolicy(MANUAL_MSG, {
      timeoutMs: 20000,
      timeoutError: new Error('PENDING_RECORD_TIMEOUT'),
      retries: 0,
      normalize: (raw: unknown): ProbeResult => {
        const response = raw as { success?: boolean; error?: string };
        if (response.success === true) return { success: true };
        return { success: false, error: response.error ?? '' };
      },
    });

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'MANUAL_RECORD',
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      payload: { title: 'T', url: 'https://example.com', content: '', force: true },
    });
    expect(result).toEqual({ success: true });
  });

  it('maps a send rejection to the failure shape without calling normalize', async () => {
    stubSendMessage(vi.fn().mockRejectedValue(new Error('Extension context invalidated')));
    const normalize = vi.fn((_raw: unknown): ProbeResult => ({ success: true }));

    const result = await sendWithPolicy(MANUAL_MSG, {
      timeoutMs: 20000,
      timeoutError: new Error('PENDING_RECORD_TIMEOUT'),
      retries: 0,
      normalize,
    });

    expect(result).toEqual({ success: false, error: 'Extension context invalidated' });
    expect(normalize).not.toHaveBeenCalled();
  });

  it('applies a custom mapError when provided', async () => {
    stubSendMessage(vi.fn().mockReturnValue(new Promise(() => undefined)));

    const pending = sendWithPolicy(MANUAL_MSG, {
      timeoutMs: 1000,
      timeoutError: new Error('GATEWAY_TIMEOUT'),
      retries: 0,
      normalize: (): ProbeResult => ({ success: true }),
      mapError: (error: unknown): ProbeResult => ({
        success: false,
        error: `wrapped:${error instanceof Error ? error.message : 'unknown'}`,
      }),
    });
    await vi.advanceTimersByTimeAsync(1000);

    await expect(pending).resolves.toEqual({ success: false, error: 'wrapped:GATEWAY_TIMEOUT' });
  });

  // eslint-disable-next-line vitest/expect-expect -- expectTypeOf() below IS the assertion (compile-time check, not counted by the rule)
  it('type-level: the default failure envelope is success: false + error and fits every gateway response contract (PBI 2026-10-20-11)', () => {
    // Compile-time assertion: defaultMapError returns SendFailure with no
    // cast, so the failure shape is checked against each gateway's response
    // type at the gateway boundary. If a response contract ever stops
    // accepting `{ success: false; error: string }`, these pins fail to
    // compile and the gateway must map the failure explicitly.
    expectTypeOf<SendFailure>().toEqualTypeOf<{ success: false; error: string }>();
    expectTypeOf<SendFailure>().toExtend<PendingRecordResult>();
    expectTypeOf<SendFailure>().toExtend<ResponseForType<'REGENERATE_SUMMARY'>>();
  });
});
