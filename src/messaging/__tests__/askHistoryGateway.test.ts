/**
 * askHistoryGateway.test.ts — wire contract (PBI 2026-10-23-08).
 * Mirrors regenerateSummaryGateway.test.ts: envelope + normalization + timeout.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTimerClock } from '../../../testDir/waitPolicy.js';
import {
  askHistory,
  ASK_HISTORY_TIMEOUT_MS,
  ASK_HISTORY_TIMEOUT_ERROR,
} from '../askHistoryGateway.js';
import { CURRENT_PROTOCOL_VERSION } from '../protocol.js';

function stubSendMessage(impl: ReturnType<typeof vi.fn>) {
  (globalThis as { chrome?: unknown }).chrome = { runtime: { sendMessage: impl } };
}

describe('askHistoryGateway', () => {
  describe('askHistory', () => {
    beforeEach(() => useTimerClock());
    afterEach(() => {
      vi.useRealTimers();
      delete (globalThis as { chrome?: unknown }).chrome;
    });

    it('sends the ASK_HISTORY envelope with protocol version', async () => {
      const sendMessage = vi.fn().mockResolvedValue({ success: true, status: 'answered', answer: 'a' });
      stubSendMessage(sendMessage);

      const result = await askHistory({ question: 'q', collectionId: null });

      expect(sendMessage).toHaveBeenCalledWith({
        type: 'ASK_HISTORY',
        payload: { question: 'q', collectionId: null },
        protocolVersion: CURRENT_PROTOCOL_VERSION,
      });
      expect(result).toEqual({ success: true, status: 'answered', answer: 'a' });
    });

    it('passes no-evidence responses through untouched', async () => {
      const sendMessage = vi.fn().mockResolvedValue({ success: true, status: 'no_evidence', suggestion: 'broaden' });
      stubSendMessage(sendMessage);

      const result = await askHistory({ question: 'q', collectionId: null });

      expect(result).toEqual({ success: true, status: 'no_evidence', suggestion: 'broaden' });
    });

    it('normalizes garbage to Invalid ASK_HISTORY response', async () => {
      const sendMessage = vi.fn().mockResolvedValue('ok');
      stubSendMessage(sendMessage);

      const result = await askHistory({ question: 'q', collectionId: null });

      expect(result).toEqual({ success: false, error: 'Invalid ASK_HISTORY response' });
    });

    it('maps sendMessage rejection to failure', async () => {
      const sendMessage = vi.fn().mockRejectedValue(new Error('Extension context invalidated'));
      stubSendMessage(sendMessage);

      const result = await askHistory({ question: 'q', collectionId: null });

      expect(result).toEqual({ success: false, error: 'Extension context invalidated' });
    });

    it('times out after ASK_HISTORY_TIMEOUT_MS (60s contract)', async () => {
      const sendMessage = vi.fn().mockReturnValue(new Promise(() => undefined));
      stubSendMessage(sendMessage);

      const pending = askHistory({ question: 'q', collectionId: null });
      await vi.advanceTimersByTimeAsync(ASK_HISTORY_TIMEOUT_MS);

      await expect(pending).resolves.toEqual({ success: false, error: ASK_HISTORY_TIMEOUT_ERROR });
    });
  });
});
