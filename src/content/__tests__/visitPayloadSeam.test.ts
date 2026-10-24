/**
 * visitPayloadSeam.test.ts (PBI 2026-10-24-05: recording-flow order single seam)
 *
 * Pins the content-side half of the seam: visitPayload is the wire packing
 * adapter that owns stat selection, and both send paths (VALID_VISIT payload
 * and GET_CONTENT reply) share that single selection with no per-path drift.
 */

import { describe, it, expect } from 'vitest';
import {
  buildVisitStats as fromAdapter,
  toGetContentReply,
  toValidVisitPayload,
} from '../visitPayload.js';
import { buildVisitStats as fromReporter } from '../visitReporter.js';
import type { PageState } from '../pageState.js';

function makePageState(): PageState {
  return {
    isValidVisitReported: false,
    lastByteStats: { pageBytes: 100, candidateBytes: 80, originalBytes: 90, cleansedBytes: 70 },
    lastAiSummaryCleansedStats: {
      aiSummaryOriginalBytes: 60,
      aiSummaryCleansedBytes: 50,
      aiSummaryCleansedElements: 3,
      aiSummaryCleansedReason: 'keyword',
      aiSummaryCleansedReasons: ['keyword'],
    },
    lastFallbackTriggered: true,
    lastCleansedReason: 'keyword',
    lastCleanseStats: {},
  } as unknown as PageState;
}

describe('visitPayload', () => {
  describe('buildVisitStats', () => {
    it('is owned by the adapter and shared through the reporter without a copy', () => {
      expect(fromReporter).toBe(fromAdapter);
      expect(fromAdapter(makePageState()).byteStats).toEqual({
        pageBytes: 100,
        candidateBytes: 80,
        originalBytes: 90,
        cleansedBytes: 70,
      });
    });
  });

  describe('wire packing', () => {
    it('shares one field selection between the VALID_VISIT payload and the GET_CONTENT reply', () => {
      const state = makePageState();
      const payload = toValidVisitPayload(state, 'body');
      const reply = toGetContentReply(state, 'body');

      expect(payload).toMatchObject({ ...reply.byteStats, ...reply.aiSummaryCleansedStats });
      expect(reply.fallbackTriggered).toBe(payload.fallbackTriggered);
      expect(reply.fallbackReason).toBe(payload.fallbackReason);
    });
  });
});
