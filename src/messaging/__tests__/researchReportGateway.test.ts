/**
 * researchReportGateway.test.ts — wire contract (PBI 2026-10-23-09).
 * Mirrors regenerateSummaryGateway.test.ts: envelope + normalization + timeout.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTimerClock } from '../../../testDir/waitPolicy.js';
import {
  exportResearchReport,
  RESEARCH_REPORT_TIMEOUT_MS,
  RESEARCH_REPORT_TIMEOUT_ERROR,
} from '../researchReportGateway.js';
import { CURRENT_PROTOCOL_VERSION } from '../protocol.js';

function stubSendMessage(impl: ReturnType<typeof vi.fn>) {
  (globalThis as { chrome?: unknown }).chrome = { runtime: { sendMessage: impl } };
}

describe('researchReportGateway', () => {
  describe('exportResearchReport', () => {
    beforeEach(() => useTimerClock());
    afterEach(() => {
      vi.useRealTimers();
      delete (globalThis as { chrome?: unknown }).chrome;
    });

    it('sends the EXPORT_RESEARCH_REPORT envelope with protocol version', async () => {
      const sendMessage = vi.fn().mockResolvedValue({ success: true, recordCount: 3 });
      stubSendMessage(sendMessage);

      const result = await exportResearchReport({ scope: { search: 'q' }, sendToObsidian: false });

      expect(sendMessage).toHaveBeenCalledWith({
        type: 'EXPORT_RESEARCH_REPORT',
        payload: { scope: { search: 'q' }, sendToObsidian: false },
        protocolVersion: CURRENT_PROTOCOL_VERSION,
      });
      expect(result).toEqual({ success: true, recordCount: 3 });
    });

    it('normalizes garbage to the pinned timeout sentence (wording not unified)', async () => {
      const sendMessage = vi.fn().mockResolvedValue('ok');
      stubSendMessage(sendMessage);

      const result = await exportResearchReport({ scope: {}, sendToObsidian: false });

      expect(result).toEqual({ success: false, error: RESEARCH_REPORT_TIMEOUT_ERROR });
    });

    it('maps sendMessage rejection to failure', async () => {
      const sendMessage = vi.fn().mockRejectedValue(new Error('Extension context invalidated'));
      stubSendMessage(sendMessage);

      const result = await exportResearchReport({ scope: {}, sendToObsidian: false });

      expect(result).toEqual({ success: false, error: 'Extension context invalidated' });
    });

    it('times out after RESEARCH_REPORT_TIMEOUT_MS (60s contract)', async () => {
      const sendMessage = vi.fn().mockReturnValue(new Promise(() => undefined));
      stubSendMessage(sendMessage);

      const pending = exportResearchReport({ scope: {}, sendToObsidian: false });
      await vi.advanceTimersByTimeAsync(RESEARCH_REPORT_TIMEOUT_MS);

      await expect(pending).resolves.toEqual({ success: false, error: RESEARCH_REPORT_TIMEOUT_ERROR });
    });
  });
});
