/**
 * responseDiscriminatedUnion.test.ts — contract pins (PBI 2026-10-23-08).
 *
 * AskHistoryResponse and ResearchReportResponse are discriminated unions so a
 * failure shape can never flow into the success path unnoticed: after a
 * `success === false` early return the compiler knows only success members
 * remain. These pins fail to compile (type-check:test) if either contract
 * drifts back to a loose `success: boolean` bag, and the runtime tables pin
 * that the shared guard preserves each full union member untouched.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';
import { asSuccessResponse } from '../normalizeGatewayResponse.js';
import type { AskHistoryCitation, AskHistoryResponse, ResearchReportResponse } from '../types.js';
import type { SendFailure } from '../sendWithPolicy.js';

/**
 * Branch copy of the panel askQuestion narrowing (sqliteHistoryPanel.ts): a
 * failure early-returns, no_evidence reads only the suggestion, answered reads
 * only answer + citations. Each field access below only compiles while the
 * union still narrows — that is the pin.
 */
function pickAskAnswer(response: AskHistoryResponse): string | null {
  if (!response.success) {
    return null;
  }
  if (response.status === 'no_evidence') {
    const suggestion: string = response.suggestion;
    return suggestion.length > 0 ? null : null;
  }
  const answer: string = response.answer;
  const citations: AskHistoryCitation[] = response.citations;
  return citations.length >= 0 ? answer : null;
}

function pickReportCount(response: ResearchReportResponse): number | null {
  if (!response.success) {
    return null;
  }
  const count: number = response.recordCount;
  const delivered: Array<'download' | 'obsidian'> = response.deliveredTo;
  return delivered.length >= 0 ? count : null;
}

describe('responseDiscriminatedUnion', () => {
  describe('AskHistoryResponse', () => {
    // eslint-disable-next-line vitest/expect-expect -- expectTypeOf() below IS the assertion (compile-time check, not counted by the rule)
    it('type-level: success and failure narrow apart and the seam failure fits the contract', () => {
      expectTypeOf<Extract<AskHistoryResponse, { success: true }>>().toEqualTypeOf<
        | { success: true; status: 'answered'; answer: string; citations: AskHistoryCitation[] }
        | { success: true; status: 'no_evidence'; suggestion: string }
      >();
      expectTypeOf<Extract<AskHistoryResponse, { success: false }>>().toEqualTypeOf<{
        success: false;
        error: string;
      }>();
      expectTypeOf<SendFailure>().toExtend<AskHistoryResponse>();
    });

    it.each([
      [
        'answered',
        { success: true, status: 'answered', answer: 'a', citations: [] },
        'a',
      ],
      [
        'no_evidence',
        { success: true, status: 'no_evidence', suggestion: 'broaden' },
        null,
      ],
      ['failure', { success: false, error: 'boom' }, null],
    ])('routes a %s payload to the narrowed branch', (_name, raw, expected) => {
      const normalized = asSuccessResponse<AskHistoryResponse>(raw, 'Invalid ASK_HISTORY response');
      expect(normalized).toBe(raw);
      expect(pickAskAnswer(normalized)).toBe(expected);
    });

    it.each([
      ['null', null],
      ['bare failure without error', { success: false }],
      ['failure with empty error', { success: false, error: '' }],
    ])('maps malformed %s to the caller sentence, never into a success member', (_name, raw) => {
      expect(asSuccessResponse<AskHistoryResponse>(raw, 'Invalid ASK_HISTORY response')).toEqual({
        success: false,
        error: 'Invalid ASK_HISTORY response',
      });
    });
  });

  describe('ResearchReportResponse', () => {
    // eslint-disable-next-line vitest/expect-expect -- expectTypeOf() below IS the assertion (compile-time check, not counted by the rule)
    it('type-level: success and failure narrow apart and the seam failure fits the contract', () => {
      expectTypeOf<Extract<ResearchReportResponse, { success: true }>>().toEqualTypeOf<{
        success: true;
        recordCount: number;
        deliveredTo: Array<'download' | 'obsidian'>;
      }>();
      expectTypeOf<Extract<ResearchReportResponse, { success: false }>>().toEqualTypeOf<{
        success: false;
        error: string;
      }>();
      expectTypeOf<SendFailure>().toExtend<ResearchReportResponse>();
    });

    it.each([
      ['delivered report', { success: true, recordCount: 3, deliveredTo: ['download'] }, 3],
      ['failure', { success: false, error: 'boom' }, null],
    ])('routes a %s payload to the narrowed branch', (_name, raw, expected) => {
      const normalized = asSuccessResponse<ResearchReportResponse>(
        raw,
        'Invalid EXPORT_RESEARCH_REPORT response',
      );
      expect(normalized).toBe(raw);
      expect(pickReportCount(normalized)).toBe(expected);
    });

    it.each([
      ['null', null],
      ['bare failure without error', { success: false }],
      ['failure with empty error', { success: false, error: '' }],
    ])('maps malformed %s to the caller sentence, never into a success member', (_name, raw) => {
      expect(
        asSuccessResponse<ResearchReportResponse>(raw, 'Invalid EXPORT_RESEARCH_REPORT response'),
      ).toEqual({ success: false, error: 'Invalid EXPORT_RESEARCH_REPORT response' });
    });
  });
});
