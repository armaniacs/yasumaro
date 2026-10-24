/**
 * normalizeGatewayResponse.test.ts — shared guard contract (PBI 2026-10-23-03).
 * Pins that the single definition of "well-formed" (a boolean `success`
 * flag, plus a non-empty string `error` on failures, never an array)
 * passes successes and well-formed failures through untouched and maps
 * every other shape to the caller's own failure sentence.
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
  ['non-empty array', [{ success: true, answer: 'a' }]],
  ['array carrying a success flag', arrayWithSuccessFlag()],
  ['bare failure without error', { success: false }],
  ['failure with undefined error', { success: false, error: undefined }],
  ['failure with empty error', { success: false, error: '' }],
  ['failure with blank error', { success: false, error: '   ' }],
  ['failure with null error', { success: false, error: null }],
  ['failure with numeric error', { success: false, error: 42 }],
  ['failure with boolean error', { success: false, error: false }],
  ['failure with object error', { success: false, error: { code: 1 } }],
  ['failure with array error', { success: false, error: ['x'] }],
];

function arrayWithSuccessFlag(): unknown {
  const flagged: Array<unknown> & { success?: boolean } = [{ success: true, answer: 'a' }];
  flagged.success = true;
  return flagged;
}

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

    it('keeps failures with a non-empty string error untouched', () => {
      const failedWithExtras = { success: false, error: 'SOME_REASON', needsForce: true };
      expect(asSuccessResponse<ProbeResponse>(failedWithExtras, INVALID_SENTENCE)).toBe(failedWithExtras);
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
