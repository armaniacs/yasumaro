/**
 * dashboardGateway-transport.test.ts
 * PBI 2026-09-18-10: the send port is injectable; the wire envelope,
 * 10s timeout, and confirmToken flow are byte-identical through a fake port,
 * and chrome.runtime.sendMessage is not touched when a port is injected.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  dashboardGateway,
  setDashboardTransportForTesting,
  resetDashboardTransportForTesting,
} from '../dashboardGateway.js';
import { CURRENT_PROTOCOL_VERSION } from '../../background/messageTypes.js';

describe('dashboardGateway transport wiring (PBI 10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDashboardTransportForTesting();
  });
  afterEach(() => {
    resetDashboardTransportForTesting();
    vi.useRealTimers();
  });

  it('sends the identical wire envelope through an injected port (exempt op)', async () => {
    const sent: unknown[] = [];
    const chromeSend = vi.fn(() => {
      throw new Error('chrome.runtime.sendMessage must not be called when a port is injected');
    });
    (globalThis as unknown as { chrome: { runtime: Record<string, unknown> } }).chrome.runtime.sendMessage = chromeSend;
    setDashboardTransportForTesting({
      send: async (message: unknown) => {
        sent.push(message);
        return { success: true, rows: [] as never[] };
      },
    });
    const result = await dashboardGateway.callDashboard(
      { subtype: 'search', query: 'hi' } as never,
      (r) => r as never,
      'fallback',
    );
    expect(result.success).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      type: 'DASHBOARD_SQLITE',
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      payload: { subtype: 'search', query: 'hi' },
    });
    expect(chromeSend).not.toHaveBeenCalled();
  });

  it('times out identically through a hanging injected port', async () => {
    vi.useFakeTimers();
    setDashboardTransportForTesting({ send: () => new Promise(() => {}) });
    const promise = dashboardGateway.callDashboard(
      { subtype: 'search', query: 'hi' } as never,
      (r) => r as never,
      'fallback',
    );
    await vi.advanceTimersByTimeAsync(10000);
    const result = await promise;
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toContain('timed out');
  });

  it('runs the confirmToken flow through the injected port for destructive ops', async () => {
    const sent: unknown[] = [];
    setDashboardTransportForTesting({
      send: async (message: unknown) => {
        sent.push(message);
        const subtype = (message as { payload: { subtype: string } }).payload.subtype;
        if (subtype === 'create_confirm_token') return { success: true, confirmToken: 'tok-injected' };
        return { success: true };
      },
    });
    const result = await dashboardGateway.callDashboard(
      { subtype: 'delete', id: 7 } as never,
      (r) => r as never,
      'fallback',
    );
    expect(result.success).toBe(true);
    expect(sent).toHaveLength(2);
    expect((sent[1] as { payload: Record<string, unknown> }).payload).toMatchObject({
      subtype: 'delete',
      confirmToken: 'tok-injected',
    });
  });
});
