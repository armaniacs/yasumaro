import { describe, it, expect } from 'vitest';
import {
  ValidVisitValidator,
  ValidationError,
  MAX_BYTE_STAT_BYTES,
  MAX_CLEANSED_ELEMENTS,
  MAX_CLEANSED_REASON_CHARS,
  MAX_CLEANSED_REASONS,
} from '../validators.js';

const v = new ValidVisitValidator();

function visit(payload: Record<string, unknown>): unknown {
  return { type: 'VALID_VISIT', payload: { content: 'hello', ...payload } };
}

const BYTE_FIELDS = [
  'pageBytes',
  'candidateBytes',
  'originalBytes',
  'cleansedBytes',
  'aiSummaryOriginalBytes',
  'aiSummaryCleansedBytes',
];

describe('ValidVisitValidator ByteStats bounds', () => {
  it('accepts a realistic payload with all 9 fields unchanged', () => {
    const msg = v.validate(
      visit({
        pageBytes: 184_320,
        candidateBytes: 96_000,
        originalBytes: 120_000,
        cleansedBytes: 88_000,
        aiSummaryOriginalBytes: 4_096,
        aiSummaryCleansedBytes: 3_800,
        aiSummaryCleansedElements: 37,
        aiSummaryCleansedReason: 'multiple',
        aiSummaryCleansedReasons: ['ads', 'nav'],
      }),
    );
    expect(msg.payload.pageBytes).toBe(184_320);
    expect(msg.payload.aiSummaryCleansedElements).toBe(37);
    expect(msg.payload.aiSummaryCleansedReasons).toEqual(['ads', 'nav']);
  });

  it.each(BYTE_FIELDS)('accepts %s at the valid max', (field) => {
    expect(() => v.validate(visit({ [field]: MAX_BYTE_STAT_BYTES }))).not.toThrow();
  });

  it.each(BYTE_FIELDS)('rejects %s at max+1', (field) => {
    expect(() => v.validate(visit({ [field]: MAX_BYTE_STAT_BYTES + 1 }))).toThrow(ValidationError);
  });

  it.each(BYTE_FIELDS)('rejects %s when negative', (field) => {
    expect(() => v.validate(visit({ [field]: -1 }))).toThrow(ValidationError);
  });

  it.each(BYTE_FIELDS)('rejects %s at 10^15', (field) => {
    expect(() => v.validate(visit({ [field]: 10 ** 15 }))).toThrow(ValidationError);
  });

  it.each(BYTE_FIELDS)('rejects %s when non-integer', (field) => {
    expect(() => v.validate(visit({ [field]: 1.5 }))).toThrow(ValidationError);
  });

  it.each(BYTE_FIELDS)('rejects %s when not a number', (field) => {
    expect(() => v.validate(visit({ [field]: '123' }))).toThrow(ValidationError);
    expect(() => v.validate(visit({ [field]: NaN }))).toThrow(ValidationError);
    expect(() => v.validate(visit({ [field]: Infinity }))).toThrow(ValidationError);
  });

  it('accepts aiSummaryCleansedElements at the valid max and rejects max+1/-1/2^31', () => {
    expect(() =>
      v.validate(visit({ aiSummaryCleansedElements: MAX_CLEANSED_ELEMENTS })),
    ).not.toThrow();
    expect(() =>
      v.validate(visit({ aiSummaryCleansedElements: MAX_CLEANSED_ELEMENTS + 1 })),
    ).toThrow(ValidationError);
    expect(() => v.validate(visit({ aiSummaryCleansedElements: -1 }))).toThrow(ValidationError);
    expect(() => v.validate(visit({ aiSummaryCleansedElements: 2 ** 31 }))).toThrow(
      ValidationError,
    );
  });

  it('accepts a max-length aiSummaryCleansedReason and rejects over-long/non-string', () => {
    expect(() =>
      v.validate(visit({ aiSummaryCleansedReason: 'x'.repeat(MAX_CLEANSED_REASON_CHARS) })),
    ).not.toThrow();
    expect(() =>
      v.validate(visit({ aiSummaryCleansedReason: 'x'.repeat(MAX_CLEANSED_REASON_CHARS + 1) })),
    ).toThrow(ValidationError);
    expect(() => v.validate(visit({ aiSummaryCleansedReason: 42 }))).toThrow(ValidationError);
  });

  it('accepts aiSummaryCleansedReasons at the element-count cap and rejects over-cap arrays', () => {
    expect(() =>
      v.validate(visit({ aiSummaryCleansedReasons: Array(MAX_CLEANSED_REASONS).fill('ads') })),
    ).not.toThrow();
    expect(() =>
      v.validate(
        visit({ aiSummaryCleansedReasons: Array(MAX_CLEANSED_REASONS + 1).fill('ads') }),
      ),
    ).toThrow(ValidationError);
  });

  it('rejects aiSummaryCleansedReasons with non-string or over-long elements', () => {
    expect(() => v.validate(visit({ aiSummaryCleansedReasons: ['ads', 42] }))).toThrow(
      ValidationError,
    );
    expect(() =>
      v.validate({
        aiSummaryCleansedReasons: ['x'.repeat(MAX_CLEANSED_REASON_CHARS + 1)],
      }),
    ).toThrow(ValidationError);
    expect(() => v.validate(visit({ aiSummaryCleansedReasons: 'ads' }))).toThrow(
      ValidationError,
    );
  });
});
