/**
 * dashboardGateway-seam-wiring.test.ts — wiring pins for PBI 2026-11-20-04.
 *
 * Verifies the rewire, not the contracts (those live in
 * dashboardGateway-seam-parity.test.ts):
 * - confirmToken attach is a pre-send hook (dashboardPreSendHook)
 * - retry is a policy argument delegated to the shared runner
 * - defineGateway accepts and applies a preSend hook, defaulting to off
 *
 * No real-time waits: retry delays use an injected no-op sleep.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DashboardGateway, dashboardPreSendHook } from '../dashboardGateway.js';
import { defineGateway, AI_GATEWAY_TIMEOUT_MS } from '../gatewayFactory.js';
import { CURRENT_PROTOCOL_VERSION } from '../protocol.js';

function installChromeMock(): void {
  if (!(globalThis as unknown as { chrome?: unknown }).chrome) {
    (globalThis as unknown as { chrome?: unknown }).chrome = {};
  }
  if (!(globalThis as unknown as { chrome: { runtime?: unknown } }).chrome.runtime) {
    (globalThis as unknown as { chrome: { runtime?: unknown } }).chrome.runtime = {};
  }
}

type SendMessageMock = ReturnType<typeof vi.fn>;

function stubSendMessage(impl: SendMessageMock): SendMessageMock {
  (globalThis as unknown as { chrome: { runtime: { sendMessage: unknown } } }).chrome.runtime.sendMessage = impl;
  return impl;
}

const noSleep = async (): Promise<void> => {};

describe('dashboard pre-send hook wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installChromeMock();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('attaches the issued token to a copy of the payload', async () => {
    stubSendMessage(
      vi.fn(async (msg: { payload: { subtype: string } }) => {
        expect(msg.payload.subtype).toBe('create_confirm_token');
        return { success: true, confirmToken: 'tok-hook-1' };
      }),
    );

    const result = await dashboardPreSendHook({ subtype: 'delete', id: 3 } as never);

    expect(result).toMatchObject({ subtype: 'delete', id: 3, confirmToken: 'tok-hook-1' });
  });

  it('throws fail-closed when no token is available', async () => {
    stubSendMessage(vi.fn(async () => ({ success: false, error: 'no token' })));

    await expect(dashboardPreSendHook({ subtype: 'delete', id: 3 } as never)).rejects.toThrow(
      'Dashboard confirm token unavailable',
    );
  });
});

describe('dashboard retry policy delegation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installChromeMock();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('retries once on a retriable failure when the policy allows two attempts', async () => {
    let calls = 0;
    const sendMessageMock = stubSendMessage(
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) return { success: false, error: 'DB locked', retriable: true };
        return { success: true, rows: [], total: 0 };
      }),
    );

    const gateway = new DashboardGateway();
    const result = await gateway.callDashboard(
      { subtype: 'query' } as never,
      (res: unknown) => (res as { total: number }).total,
      'Query failed',
      { retryAttempts: 2, retryDelayMs: 1000, sleep: noSleep },
    );

    expect(result).toEqual({ success: true, data: 0 });
    expect(sendMessageMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry when the policy allows a single attempt', async () => {
    const sendMessageMock = stubSendMessage(
      vi.fn(async () => ({ success: false, error: 'DB locked', retriable: true })),
    );

    const gateway = new DashboardGateway();
    const result = await gateway.callDashboard(
      { subtype: 'query' } as never,
      () => undefined,
      'Query failed',
      { retryAttempts: 1, retryDelayMs: 1000, sleep: noSleep },
    );

    expect(result.success).toBe(false);
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
  });
});

describe('defineGateway hook acceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installChromeMock();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it('applies the preSend hook before stamping the envelope', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ success: true, answer: 'a' });
    stubSendMessage(sendMessage);

    const gateway = defineGateway<'ASK_HISTORY', { question: string; collectionId?: string | null }, { success: boolean }>({
      type: 'ASK_HISTORY',
      timeoutMs: AI_GATEWAY_TIMEOUT_MS,
      timeoutError: 'timed out',
      invalidMessage: 'Invalid ASK_HISTORY response',
      preSend: async (payload) => ({ ...payload, question: `${payload.question}!` }),
    });
    await gateway.send({ question: 'q', collectionId: null });

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'ASK_HISTORY',
      payload: { question: 'q!', collectionId: null },
      protocolVersion: CURRENT_PROTOCOL_VERSION,
    });
  });

  it('returns SendFailure when the preSend hook hangs past the timeout (no real-time wait)', async () => {
    const { useTimerClock } = await import('../../../testDir/waitPolicy.js');
    useTimerClock();
    try {
      const sendMessage = vi.fn().mockResolvedValue({ success: true, answer: 'a' });
      stubSendMessage(sendMessage);

      const gateway = defineGateway<'ASK_HISTORY', { question: string; collectionId?: string | null }, { success: boolean }>({
        type: 'ASK_HISTORY',
        timeoutMs: 100,
        timeoutError: 'timed out',
        invalidMessage: 'Invalid ASK_HISTORY response',
        preSend: () => new Promise<never>(() => undefined),
      });
      const pending = gateway.send({ question: 'q', collectionId: null });
      await vi.advanceTimersByTimeAsync(100);

      await expect(pending).resolves.toEqual({ success: false, error: 'timed out' });
      expect(sendMessage).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends the payload untouched when no hook is declared', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ success: true, answer: 'a' });
    stubSendMessage(sendMessage);

    const gateway = defineGateway<'ASK_HISTORY', { question: string; collectionId?: string | null }, { success: boolean }>({
      type: 'ASK_HISTORY',
      timeoutMs: AI_GATEWAY_TIMEOUT_MS,
      timeoutError: 'timed out',
      invalidMessage: 'Invalid ASK_HISTORY response',
    });
    expect(gateway.preSend).toBeUndefined();
    await gateway.send({ question: 'q', collectionId: null });

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'ASK_HISTORY',
      payload: { question: 'q', collectionId: null },
      protocolVersion: CURRENT_PROTOCOL_VERSION,
    });
  });
});
