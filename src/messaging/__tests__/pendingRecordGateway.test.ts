import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  recordPendingPage,
  PENDING_RECORD_TIMEOUT_MS,
  PENDING_RECORD_TIMEOUT_ERROR,
} from '../pendingRecordGateway.js';

describe('pendingRecordGateway', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the MANUAL_RECORD envelope with protocol version and normalizes success', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ success: true });
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: { sendMessage },
    };

    const result = await recordPendingPage({
      title: 'T',
      url: 'https://example.com',
      content: 'body',
      force: false,
    });

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'MANUAL_RECORD',
      protocolVersion: 1,
      payload: { title: 'T', url: 'https://example.com', content: 'body', force: false },
    });
    expect(result).toEqual({ success: true });
  });

  it('defaults content to empty string and force to true, omits unset skipAi', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ success: true });
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: { sendMessage },
    };

    await recordPendingPage({ title: 'T', url: 'https://example.com' });

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'MANUAL_RECORD',
      protocolVersion: 1,
      payload: { title: 'T', url: 'https://example.com', content: '', force: true },
    });
  });

  it('never sends a message type outside VALID_MESSAGE_TYPES (dead record envelope)', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ success: true });
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: { sendMessage },
    };

    await recordPendingPage({ title: 'T', url: 'https://example.com' });

    const sent = sendMessage.mock.calls[0][0] as { type: string };
    expect(sent.type).toBe('MANUAL_RECORD');
    expect(sent.type).not.toBe('record');
  });

  it('returns failure with the backend error message', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ success: false, error: 'Connection failed' });
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: { sendMessage },
    };

    const result = await recordPendingPage({ title: 'T', url: 'https://example.com' });

    expect(result).toEqual({ success: false, error: 'Connection failed' });
  });

  it('returns the timeout sentinel instead of hanging when no response arrives', async () => {
    const sendMessage = vi.fn().mockReturnValue(new Promise(() => undefined));
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: { sendMessage },
    };

    const pending = recordPendingPage({ title: 'T', url: 'https://example.com' });
    await vi.advanceTimersByTimeAsync(PENDING_RECORD_TIMEOUT_MS);
    await expect(pending).resolves.toEqual({
      success: false,
      error: PENDING_RECORD_TIMEOUT_ERROR,
    });
  });

  it('catches sendMessage rejections and returns a failure result', async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error('Extension context invalidated'));
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: { sendMessage },
    };

    const result = await recordPendingPage({ title: 'T', url: 'https://example.com' });

    expect(result).toEqual({ success: false, error: 'Extension context invalidated' });
  });
});
