/**
 * dashboardGateway-token-reissue.test.ts
 *
 * The sender re-issues a confirmToken once when the receiver reports a
 * mismatch (PBI 2026-09-16-01).
 *
 * Why this exists: tokens live in chrome.storage.session, which dies with the
 * MV3 service worker. A token issued before an idle shutdown is gone by the
 * time it is verified, so a perfectly valid, unused, in-TTL token is rejected
 * through no fault of the caller. Retrying once turns that into a successful
 * operation instead of an error the user cannot act on.
 *
 * What must NOT change with the retry:
 * - the re-issued token binds the same payload (no widening of scope)
 * - exactly one retry (a genuine rejection still surfaces)
 * - no retry for any other failure (an operation that ran must not run twice)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DashboardGateway } from '../dashboardGateway.js';
import { CONFIRM_TOKEN_MISMATCH_ERROR } from '../sqliteOperationSecurity.js';

interface SentMessage {
  payload: { subtype: string; confirmToken?: string; scopeHash?: string; cutoffMs?: number };
}

function installChromeMock() {
  if (!(globalThis as any).chrome) (globalThis as any).chrome = {};
  if (!(globalThis as any).chrome.runtime) (globalThis as any).chrome.runtime = {};
}

/** Subtypes sent by the gateway that are not the token request itself. */
function operationCalls(mock: { mock: { calls: unknown[][] } }): SentMessage[] {
  return mock.mock.calls
    .map((c) => c[0] as SentMessage)
    .filter((m) => m.payload.subtype !== 'create_confirm_token');
}

describe('DashboardGateway — confirm token re-issue on mismatch', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    installChromeMock();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('retries once with a fresh token when the first token is reported missing', async () => {
    let issued = 0;
    const sendMessageMock = vi.fn(async (msg: SentMessage) => {
      if (msg.payload.subtype === 'create_confirm_token') {
        issued += 1;
        return { success: true, confirmToken: `token-${issued}` };
      }
      // The first attempt hits a service worker that lost its token store.
      if (msg.payload.confirmToken === 'token-1') {
        return { success: false, error: CONFIRM_TOKEN_MISMATCH_ERROR };
      }
      return { success: true };
    });
    (globalThis as any).chrome.runtime.sendMessage = sendMessageMock;

    const gateway = new DashboardGateway();
    const result = await gateway.callDashboard(
      { subtype: 'delete', id: 7 } as never,
      () => true,
      'delete failed',
    );

    expect(result.success).toBe(true);
    expect(issued).toBe(2);

    const ops = operationCalls(sendMessageMock);
    expect(ops).toHaveLength(2);
    expect(ops[0]?.payload.confirmToken).toBe('token-1');
    expect(ops[1]?.payload.confirmToken).toBe('token-2');
  });

  it('retries at most once — a second mismatch surfaces as a failure', async () => {
    const sendMessageMock = vi.fn(async (msg: SentMessage) => {
      if (msg.payload.subtype === 'create_confirm_token') {
        return { success: true, confirmToken: 'token' };
      }
      return { success: false, error: CONFIRM_TOKEN_MISMATCH_ERROR };
    });
    (globalThis as any).chrome.runtime.sendMessage = sendMessageMock;

    const gateway = new DashboardGateway();
    const result = await gateway.callDashboard(
      { subtype: 'delete', id: 7 } as never,
      () => true,
      'delete failed',
    );

    expect(result.success).toBe(false);
    // Two operation attempts, not an unbounded loop.
    expect(operationCalls(sendMessageMock)).toHaveLength(2);
  });

  it('does not retry other failures — an operation that ran must not run twice', async () => {
    const sendMessageMock = vi.fn(async (msg: SentMessage) => {
      if (msg.payload.subtype === 'create_confirm_token') {
        return { success: true, confirmToken: 'token' };
      }
      return { success: false, error: 'disk I/O error' };
    });
    (globalThis as any).chrome.runtime.sendMessage = sendMessageMock;

    const gateway = new DashboardGateway();
    const result = await gateway.callDashboard(
      { subtype: 'delete', id: 7 } as never,
      () => true,
      'delete failed',
    );

    expect(result.success).toBe(false);
    expect(operationCalls(sendMessageMock)).toHaveLength(1);
  });

  it('re-derives the scope on retry so the new token cannot widen the operation', async () => {
    let issued = 0;
    const tokenRequests: SentMessage[] = [];
    const sendMessageMock = vi.fn(async (msg: SentMessage) => {
      if (msg.payload.subtype === 'create_confirm_token') {
        issued += 1;
        tokenRequests.push(msg);
        return { success: true, confirmToken: `token-${issued}` };
      }
      if (msg.payload.confirmToken === 'token-1') {
        return { success: false, error: CONFIRM_TOKEN_MISMATCH_ERROR };
      }
      return { success: true, stagingName: 'staging', recordCount: 0 };
    });
    (globalThis as any).chrome.runtime.sendMessage = sendMessageMock;

    const gateway = new DashboardGateway();
    await gateway.callDashboard(
      { subtype: 'archive_create', cutoffMs: 1_700_000_000_000, includeDeleted: false } as never,
      () => true,
      'archive failed',
    );

    expect(tokenRequests).toHaveLength(2);
    // Both issuances bind the same scope: the retry authorizes exactly the
    // operation the first attempt did, never a broader one.
    expect(tokenRequests[1]?.payload.scopeHash).toBe(tokenRequests[0]?.payload.scopeHash);
    expect(tokenRequests[0]?.payload.scopeHash).toBeDefined();
  });

  it('does not request a token at all for exempt read-only ops', async () => {
    const sendMessageMock = vi.fn(async () => ({ success: true, rows: [], total: 0 }));
    (globalThis as any).chrome.runtime.sendMessage = sendMessageMock;

    const gateway = new DashboardGateway();
    await gateway.callDashboard(
      { subtype: 'query', limit: 10, offset: 0 } as never,
      () => true,
      'query failed',
    );

    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect((sendMessageMock.mock.calls[0]?.[0] as SentMessage).payload.subtype).toBe('query');
  });
});
