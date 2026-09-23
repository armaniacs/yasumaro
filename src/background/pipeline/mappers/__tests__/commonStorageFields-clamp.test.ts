import { describe, it, expect } from 'vitest';
import { extractCommonStorageFields } from '../commonStorageFields.js';
import {
  MAX_BYTE_STAT_BYTES,
  MAX_CLEANSED_ELEMENTS,
  MAX_CLEANSED_REASON_CHARS,
  MAX_CLEANSED_REASONS,
} from '../../../../messaging/validators.js';
import type { RecordingContext } from '../../types.js';

function makeContext(data: Record<string, unknown>): RecordingContext {
  return {
    data: {
      title: 'Test',
      url: 'https://example.com/page',
      content: 'body',
      recordType: 'auto',
      ...data,
    },
    settings: {},
    force: false,
    errors: [],
  } as RecordingContext;
}

describe('extractCommonStorageFields ByteStats clamp', () => {
  it('passes realistic values through unchanged', () => {
    const common = extractCommonStorageFields(
      makeContext({
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

    expect(common).toMatchObject({
      pageBytes: 184_320,
      candidateBytes: 96_000,
      originalBytes: 120_000,
      cleansedBytes: 88_000,
      aiSummaryOriginalBytes: 4_096,
      aiSummaryCleansedBytes: 3_800,
      aiSummaryCleansedElements: 37,
      aiSummaryCleansedReason: 'multiple',
      aiSummaryCleansedReasons: ['ads', 'nav'],
    });
  });

  it('clamps 10^15 byte counts to the max instead of storing them raw', () => {
    const common = extractCommonStorageFields(makeContext({ pageBytes: 10 ** 15 }));

    expect(common.pageBytes).toBe(MAX_BYTE_STAT_BYTES);
  });

  it('clamps negative byte counts to 0', () => {
    const common = extractCommonStorageFields(makeContext({ cleansedBytes: -999999 }));

    expect(common.cleansedBytes).toBe(0);
  });

  it('clamps 2^31 element counts to the element max', () => {
    const common = extractCommonStorageFields(
      makeContext({ aiSummaryCleansedElements: 2 ** 31 }),
    );

    expect(common.aiSummaryCleansedElements).toBe(MAX_CLEANSED_ELEMENTS);
  });

  it('maps non-numeric byte values to null', () => {
    for (const bad of [NaN, Infinity, '123', null, {}, []]) {
      const common = extractCommonStorageFields(makeContext({ pageBytes: bad }));
      expect(common.pageBytes).toBeNull();
    }
  });

  it('truncates fractional byte values instead of storing floats', () => {
    const common = extractCommonStorageFields(makeContext({ pageBytes: 100.9 }));

    expect(common.pageBytes).toBe(100);
  });

  it('truncates an over-long cleansed reason and maps non-strings to null', () => {
    const long = extractCommonStorageFields(
      makeContext({ aiSummaryCleansedReason: 'x'.repeat(MAX_CLEANSED_REASON_CHARS + 10) }),
    );
    expect(long.aiSummaryCleansedReason).toBe('x'.repeat(MAX_CLEANSED_REASON_CHARS));

    const bad = extractCommonStorageFields(makeContext({ aiSummaryCleansedReason: 42 }));
    expect(bad.aiSummaryCleansedReason).toBeNull();
  });

  it('caps the reasons array, drops non-strings, and truncates over-long elements', () => {
    const common = extractCommonStorageFields(
      makeContext({
        aiSummaryCleansedReasons: [
          ...Array(MAX_CLEANSED_REASONS + 10).fill('ads'),
          42,
          'y'.repeat(MAX_CLEANSED_REASON_CHARS + 5),
        ],
      }),
    );

    expect(common.aiSummaryCleansedReasons).toHaveLength(MAX_CLEANSED_REASONS);
    expect(common.aiSummaryCleansedReasons).toEqual(Array(MAX_CLEANSED_REASONS).fill('ads'));
  });

  it('maps a non-array reasons value to null', () => {
    const common = extractCommonStorageFields(
      makeContext({ aiSummaryCleansedReasons: 'ads' }),
    );

    expect(common.aiSummaryCleansedReasons).toBeNull();
  });

  it('never exposes raw absurd values through toMetadataPatch', () => {
    const common = extractCommonStorageFields(
      makeContext({ pageBytes: 10 ** 15, cleansedBytes: -999999 }),
    );
    const patch = common.toMetadataPatch();

    expect(patch.pageBytes).toBe(MAX_BYTE_STAT_BYTES);
    expect(patch.cleansedBytes).toBe(0);
  });
});
