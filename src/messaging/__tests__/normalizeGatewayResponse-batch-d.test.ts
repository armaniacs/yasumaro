/**
 * normalizeGatewayResponse-batch-d.test.ts — PBI 2026-11-08-12 (item 6) pins.
 *
 * Extra fields no longer pass silently: on a well-formed failure envelope
 * (the only shape this seam can fully judge) the extra key names are
 * reported through `onExtraFields`, while the fields themselves are still
 * passed through because downstream display narrowing
 * (`toRegenerateErrorDisplay`) depends on them via `in` checks.
 */
import { describe, it, expect, vi } from 'vitest';
import { asSuccessResponse } from '../normalizeGatewayResponse.js';

interface ProbeResponse {
  success: boolean;
  error?: string;
  answer?: string;
}

const INVALID_SENTENCE = 'Invalid PROBE response';

describe('asSuccessResponse extra-field reporting (PBI 2026-11-08-12 item 6)', () => {
  it('reports extra keys on a well-formed failure without dropping them', () => {
    const onExtraFields = vi.fn();
    const failed = { success: false, error: 'SOME_REASON', needsForce: true };
    const result = asSuccessResponse<ProbeResponse>(failed, INVALID_SENTENCE, onExtraFields);

    expect(result).toBe(failed);
    expect(onExtraFields).toHaveBeenCalledTimes(1);
    expect(onExtraFields).toHaveBeenCalledWith(['needsForce']);
  });

  it('stays silent for a failure with exactly the canonical shape', () => {
    const onExtraFields = vi.fn();
    const failed = { success: false, error: 'SOME_REASON' };
    const result = asSuccessResponse<ProbeResponse>(failed, INVALID_SENTENCE, onExtraFields);

    expect(result).toBe(failed);
    expect(onExtraFields).not.toHaveBeenCalled();
  });

  it('does not judge extra keys on success envelopes (R is caller-owned)', () => {
    const onExtraFields = vi.fn();
    const answered = { success: true, answer: 'a' };
    const result = asSuccessResponse<ProbeResponse>(answered, INVALID_SENTENCE, onExtraFields);

    expect(result).toBe(answered);
    expect(onExtraFields).not.toHaveBeenCalled();
  });

  it('keeps the two-argument behavior byte-identical when no hook is given', () => {
    const failed = { success: false, error: 'SOME_REASON', needsForce: true };
    expect(asSuccessResponse<ProbeResponse>(failed, INVALID_SENTENCE)).toBe(failed);
  });
});
