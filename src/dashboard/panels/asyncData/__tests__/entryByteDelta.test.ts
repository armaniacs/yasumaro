import { describe, it, expect } from 'vitest';
import { describeDelta, formatBytes } from '../entryByteDelta.js';

describe('formatBytes (PBI 2026-09-12-21)', () => {
  it('uses the MB/KB/B unit table', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
  });
});

describe('describeDelta (PBI 2026-09-12-21)', () => {
  it('computes label, percent and ratio for a normal delta', () => {
    const delta = describeDelta(2000, 1000);
    expect(delta).not.toBeNull();
    expect(delta!.label).toBe('2.0 KB → 1000 B');
    expect(delta!.percent).toBe('50.0');
    expect(delta!.ratio).toBeCloseTo(0.5);
  });

  it('returns null when page_bytes is 0 (the historical Infinity%/NaN% branch)', () => {
    expect(describeDelta(0, 0)).toBeNull();
    expect(describeDelta(0, 500)).toBeNull();
  });

  it('returns null when either side is missing', () => {
    expect(describeDelta(null, 100)).toBeNull();
    expect(describeDelta(100, null)).toBeNull();
    expect(describeDelta(undefined, undefined)).toBeNull();
  });

  it('honors a legitimate 0-byte cleansed value (?? semantics, never a fallback)', () => {
    const delta = describeDelta(1000, 0);
    expect(delta).not.toBeNull();
    expect(delta!.cleansed).toBe(0);
    expect(delta!.percent).toBe('99.9'); // capped at the ceiling
    expect(delta!.ratio).toBe(0);
  });

  it('caps the percent at 99.9 and clamps growth to ratio 1', () => {
    const grown = describeDelta(100, 500); // "reduction" negative — size grew
    expect(grown).not.toBeNull();
    expect(grown!.ratio).toBe(1);
    expect(grown!.percent).toBe('0.0');
  });
});
