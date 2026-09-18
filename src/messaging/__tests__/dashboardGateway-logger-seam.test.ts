/**
 * dashboardGateway-logger-seam.test.ts
 * PBI 2026-09-18-06: failures are reported through the logger seam
 * (no console.* direct calls remain in dashboardGateway.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger/api.js', () => ({
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

import { dashboardGateway } from '../dashboardGateway.js';
import { logWarn, logError } from '../../utils/logger/api.js';

describe('dashboardGateway logger seam (PBI 06)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes a failure response through logWarn with an unchanged shape', async () => {
    (globalThis as unknown as { chrome: { runtime: Record<string, unknown> } }).chrome.runtime.sendMessage = vi
      .fn()
      .mockResolvedValueOnce({ success: true, confirmToken: 'tok-1' })
      .mockResolvedValueOnce({ success: false, error: 'nope' });
    const result = await dashboardGateway.callDashboard(
      { subtype: 'delete', id: 1 } as never,
      (r) => r as never,
      'fallback message',
    );
    expect(result).toEqual({
      success: false,
      error: { kind: 'unknown', message: 'nope', retriable: false },
    });
    expect(logWarn).toHaveBeenCalledWith('delete failed', expect.objectContaining({ error: 'nope' }), expect.anything(), 'dashboardGateway');
  });

  it('routes a decode failure through logWarn', async () => {
    (globalThis as unknown as { chrome: { runtime: Record<string, unknown> } }).chrome.runtime.sendMessage = vi
      .fn()
      .mockResolvedValueOnce({ success: true, confirmToken: 'tok-1' })
      .mockResolvedValueOnce({ success: true });
    const result = await dashboardGateway.callDashboard(
      { subtype: 'delete', id: 1 } as never,
      () => {
        throw new Error('bad shape');
      },
      'fallback message',
    );
    expect(result).toEqual({
      success: false,
      error: { kind: 'unknown', message: 'bad shape', retriable: false },
    });
    expect(logWarn).toHaveBeenCalledWith(
      'delete decode failed',
      expect.objectContaining({ error: 'bad shape' }),
      expect.anything(),
      'dashboardGateway',
    );
  });

  it('routes a send throw through logError', async () => {
    (globalThis as unknown as { chrome: { runtime: Record<string, unknown> } }).chrome.runtime.sendMessage = vi
      .fn()
      .mockResolvedValueOnce({ success: true, confirmToken: 'tok-1' })
      .mockRejectedValueOnce(new Error('transport down'));
    const result = await dashboardGateway.callDashboard(
      { subtype: 'delete', id: 1 } as never,
      (r) => r as never,
      'fallback message',
    );
    expect(result.success).toBe(false);
    expect(logError).toHaveBeenCalledWith('delete failed', expect.objectContaining({}), expect.anything(), 'dashboardGateway');
  });
});
