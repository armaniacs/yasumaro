/**
 * captureOutcome.test.ts
 * PBI 2026-10-22-06 slice 2 (diag wiring): pins the outcome vocabulary.
 * Success reads 'recorded', a settled rejection quotes the worker's own
 * error/reason verbatim (the string the dashboard table classifies), and
 * foreign persisted shapes normalize to null instead of half-records.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveOutcomeCode,
  normalizeOutcome,
  NO_RESPONSE_OUTCOME_CODE,
  RECORDED_OUTCOME_CODE,
} from '../captureOutcome.js';

describe('deriveOutcomeCode', () => {
  it("reads 'recorded' on success", () => {
    expect(deriveOutcomeCode({ success: true })).toBe(RECORDED_OUTCOME_CODE);
  });

  it('quotes the worker error/reason verbatim on settled failure', () => {
    expect(deriveOutcomeCode({ success: false, error: 'DOMAIN_BLOCKED' })).toBe('DOMAIN_BLOCKED');
    expect(deriveOutcomeCode({ success: false, reason: 'rate_limited' })).toBe('rate_limited');
    // Error wins over reason: the terminal verdict, not the hint.
    expect(deriveOutcomeCode({ success: false, error: 'no-write', reason: 'rate_limited' })).toBe('no-write');
  });

  it("reads 'no-response' when there is no verdict to quote", () => {
    expect(deriveOutcomeCode(undefined)).toBe(NO_RESPONSE_OUTCOME_CODE);
    expect(deriveOutcomeCode({ success: false })).toBe(NO_RESPONSE_OUTCOME_CODE);
    expect(deriveOutcomeCode({ success: false, error: '' })).toBe(NO_RESPONSE_OUTCOME_CODE);
  });
});

describe('normalizeOutcome', () => {
  it('accepts a well-formed record', () => {
    expect(normalizeOutcome({ code: 'domain_excluded', at: 1729650000000 })).toEqual({
      code: 'domain_excluded',
      at: 1729650000000,
    });
  });

  it('rejects foreign shapes as null (never a half-record)', () => {
    expect(normalizeOutcome(null)).toBeNull();
    expect(normalizeOutcome(undefined)).toBeNull();
    expect(normalizeOutcome({ code: '', at: 1 })).toBeNull();
    expect(normalizeOutcome({ code: 'x', at: Number.NaN })).toBeNull();
    expect(normalizeOutcome({ code: 42, at: 1 } as unknown as { code: string; at: number })).toBeNull();
    expect(normalizeOutcome({ at: 1 })).toBeNull();
  });
});
