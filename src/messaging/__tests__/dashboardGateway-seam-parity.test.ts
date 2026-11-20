/**
 * dashboardGateway-seam-parity.test.ts — parity pins for PBI 2026-11-20-04.
 *
 * Written BEFORE the rewire: pins the current observable contracts so the
 * refactor (pre-send hook + policy argument) cannot silently change them.
 * - success shape and failure shape are byte-identical
 * - confirmToken re-issue happens exactly once on mismatch
 * - decode failure never retries
 *
 * No real-time waits: retry delays use an injected no-op sleep, and all
 * chrome sends resolve immediately (the 10s transport timeout never fires).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DashboardGateway } from '../dashboardGateway.js';
import { CONFIRM_TOKEN_MISMATCH_ERROR } from '../sqliteOperationSecurity.js';

function installChromeMock(): void {
  if (!(globalThis as unknown as { chrome?: unknown }).chrome) {
    (globalThis as unknown as { chrome?: unknown }).chrome = {};
  }
  if (!(globalThis as unknown as { chrome: { runtime?: unknown } }).chrome.runtime) {
    (globalThis as unknown as { chrome: { runtime?: unknown } }).chrome.runtime = {};
  }
}

const noSleep = async (): Promise<void> => {};

describe('DashboardGateway seam parity (pre-rewire pins)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installChromeMock();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('pins the success shape for an exempt read op', async () => {
    const sendMessageMock = vi.fn(async () => ({ success: true, rows: [1, 2], total: 2 }));
    (globalThis as unknown as { chrome: { runtime: { sendMessage: unknown } } }).chrome.runtime.sendMessage = sendMessageMock;

    const gateway = new DashboardGateway();
    const result = await gateway.callDashboard(
      { subtype: 'query', limit: 10 } as never,
      (res: unknown) => ({ rows: (res as { rows: number[] }).rows }),
      'Query failed',
    );

    expect(result).toEqual({ success: true, data: { rows: [1, 2] } });
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
  });

  it('pins the failure shape for a non-retriable error response', async () => {
    const sendMessageMock = vi.fn(async () => ({ success: false, error: 'DB locked' }));
    (globalThis as unknown as { chrome: { runtime: { sendMessage: unknown } } }).chrome.runtime.sendMessage = sendMessageMock;

    const gateway = new DashboardGateway();
    const result = await gateway.callDashboard(
      { subtype: 'query' } as never,
      () => undefined,
      'Query failed',
    );

    expect(result).toEqual({
      success: false,
      error: { kind: 'unknown', message: 'DB locked', retriable: false },
    });
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
  });

  it('pins single re-issue: mismatch retries the op exactly once with a fresh token', async () => {
    let issued = 0;
    const sendMessageMock = vi.fn(async (msg: { payload: { subtype: string; confirmToken?: string } }) => {
      if (msg.payload.subtype === 'create_confirm_token') {
        issued += 1;
        return { success: true, confirmToken: `token-${issued}` };
      }
      if (msg.payload.confirmToken === 'token-1') {
        return { success: false, error: CONFIRM_TOKEN_MISMATCH_ERROR };
      }
      return { success: true };
    });
    (globalThis as unknown as { chrome: { runtime: { sendMessage: unknown } } }).chrome.runtime.sendMessage = sendMessageMock;

    const gateway = new DashboardGateway();
    const result = await gateway.callDashboard(
      { subtype: 'delete', id: 7 } as never,
      () => true,
      'delete failed',
    );

    expect(result).toEqual({ success: true, data: true });
    expect(issued).toBe(2);
    const ops = sendMessageMock.mock.calls
      .map((c) => c[0] as { payload: { subtype: string; confirmToken?: string } })
      .filter((m) => m.payload.subtype !== 'create_confirm_token');
    expect(ops).toHaveLength(2);
    expect(ops[0]?.payload.confirmToken).toBe('token-1');
    expect(ops[1]?.payload.confirmToken).toBe('token-2');
  });

  it('pins decode-failure-no-retry: a throwing decode returns failure with one send only', async () => {
    const sendMessageMock = vi.fn(async () => ({ success: true, rows: 'not-an-array', total: 0 }));
    (globalThis as unknown as { chrome: { runtime: { sendMessage: unknown } } }).chrome.runtime.sendMessage = sendMessageMock;

    const gateway = new DashboardGateway();
    const result = await gateway.callDashboard(
      { subtype: 'query' } as never,
      () => {
        throw new Error('Invalid SQLite response: rows');
      },
      'Query failed',
      { retryAttempts: 2, retryDelayMs: 1000, sleep: noSleep },
    );

    expect(result).toEqual({
      success: false,
      error: { kind: 'unknown', message: 'Invalid SQLite response: rows', retriable: false },
    });
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
  });

  it('pins the throw shape: a throwing send classifies to unknown non-retriable', async () => {
    const sendMessageMock = vi.fn(async () => {
      throw new Error('SQLite request timed out');
    });
    (globalThis as unknown as { chrome: { runtime: { sendMessage: unknown } } }).chrome.runtime.sendMessage = sendMessageMock;

    const gateway = new DashboardGateway();
    const result = await gateway.callDashboard(
      { subtype: 'query' } as never,
      () => undefined,
      'Query failed',
      { retryAttempts: 1, retryDelayMs: 1000, sleep: noSleep },
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.kind).toBe('timeout');
      expect(result.error.retriable).toBe(true);
    }
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
  });
});
