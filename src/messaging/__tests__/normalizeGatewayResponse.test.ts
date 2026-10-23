/**
 * normalizeGatewayResponse.test.ts — shared guard contract (PBI 2026-10-23-03).
 * Pins that the single definition of "well-formed" (a boolean `success`
 * flag) passes successes through untouched and maps every other shape to
 * the caller's own failure sentence.
 */
import { describe, it, expect } from 'vitest';
import { asSuccessResponse } from '../normalizeGatewayResponse.js';

interface ProbeResponse {
  success: boolean;
  error?: string;
  answer?: string;
}

const INVALID_SENTENCE = 'Invalid PROBE response';

const MALFORMED_CASES: Array<[string, unknown]> = [
  ['null', null],
  ['undefined', undefined],
  ['string payload', 'ok'],
  ['numeric payload', 42],
  ['boolean payload', true],
  ['empty object', {}],
  ['object without success', { error: 'x' }],
  ['string success flag', { success: 'yes' }],
  ['numeric success flag', { success: 1 }],
  ['null success flag', { success: null }],
  ['array payload', []],
];

describe('normalizeGatewayResponse', () => {
  describe('asSuccessResponse', () => {
    it('returns the raw payload untouched when it carries a boolean success flag', () => {
      const answered = { success: true, answer: 'a' };
      expect(asSuccessResponse<ProbeResponse>(answered, INVALID_SENTENCE)).toBe(answered);

      const failed = { success: false, error: 'SOME_REASON' };
      expect(asSuccessResponse<ProbeResponse>(failed, INVALID_SENTENCE)).toBe(failed);
    });

    it.each(MALFORMED_CASES)('maps malformed %s to the caller sentence', (_name, raw) => {
      expect(asSuccessResponse<ProbeResponse>(raw, INVALID_SENTENCE)).toEqual({
        success: false,
        error: INVALID_SENTENCE,
      });
    });

    it('keeps each gateway sentence distinct instead of unifying wording', () => {
      expect(asSuccessResponse<ProbeResponse>(null, 'Invalid ASK_HISTORY response')).toEqual({
        success: false,
        error: 'Invalid ASK_HISTORY response',
      });
      expect(asSuccessResponse<ProbeResponse>(null, 'Research report request timed out')).toEqual({
        success: false,
        error: 'Research report request timed out',
      });
    });
  });
});
