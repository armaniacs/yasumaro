/**
 * regenerateSummaryGateway.test.ts — wire contract (PBI 2026-09-22-04).
 * Mirrors pendingRecordGateway.test.ts: envelope + normalization + timeout.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  regenerateSummary,
  REGENERATE_TIMEOUT_MS,
  REGENERATE_TIMEOUT_ERROR,
} from '../regenerateSummaryGateway.js';
import { CURRENT_PROTOCOL_VERSION } from '../protocol.js';

function stubSendMessage(impl: ReturnType<typeof vi.fn>) {
  (globalThis as { chrome?: unknown }).chrome = { runtime: { sendMessage: impl } };
}

describe('regenerateSummaryGateway', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it('sends the REGENERATE_SUMMARY envelope with protocol version', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ success: true });
    stubSendMessage(sendMessage);

    const result = await regenerateSummary({
      id: 7, url: 'https://example.com', title: 'T', cleanseMode: 'looser',
    });

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'REGENERATE_SUMMARY',
      payload: { id: 7, url: 'https://example.com', title: 'T', cleanseMode: 'looser' },
      protocolVersion: CURRENT_PROTOCOL_VERSION,
    });
    expect(result).toEqual({ success: true });
  });

  it('forwards force when provided (opt-in only)', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ success: true });
    stubSendMessage(sendMessage);

    await regenerateSummary({
      id: 7, url: 'https://example.com', title: 'T', cleanseMode: 'current', force: true,
    });

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ force: true }),
    }));
  });

  it('passes through needsForce responses untouched (CRITICAL)', async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      success: false, error: 'DOMAIN_BLOCKED', needsForce: true,
    });
    stubSendMessage(sendMessage);

    const result = await regenerateSummary({
      id: 7, url: 'https://example.com', title: 'T', cleanseMode: 'current',
    });
    expect(result).toEqual({ success: false, error: 'DOMAIN_BLOCKED', needsForce: true });
  });

  it('normalizes garbage to Invalid REGENERATE_SUMMARY response', async () => {
    const sendMessage = vi.fn().mockResolvedValue('ok');
    stubSendMessage(sendMessage);

    const result = await regenerateSummary({
      id: 7, url: 'https://example.com', title: 'T', cleanseMode: 'current',
    });
    expect(result).toEqual({ success: false, error: 'Invalid REGENERATE_SUMMARY response' });
  });

  it('maps sendMessage rejection to failure', async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error('Extension context invalidated'));
    stubSendMessage(sendMessage);

    const result = await regenerateSummary({
      id: 7, url: 'https://example.com', title: 'T', cleanseMode: 'current',
    });
    expect(result).toEqual({ success: false, error: 'Extension context invalidated' });
  });

  it('times out via Promise.race after REGENERATE_TIMEOUT_MS (60s contract)', async () => {
    const sendMessage = vi.fn().mockReturnValue(new Promise(() => undefined));
    stubSendMessage(sendMessage);

    const pending = regenerateSummary({
      id: 7, url: 'https://example.com', title: 'T', cleanseMode: 'current',
    });
    await vi.advanceTimersByTimeAsync(REGENERATE_TIMEOUT_MS);
    await expect(pending).resolves.toEqual({ success: false, error: REGENERATE_TIMEOUT_ERROR });
  });
});
