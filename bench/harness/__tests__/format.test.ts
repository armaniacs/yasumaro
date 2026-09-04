/**
 * format.test.ts — shared number formatting used by both renderers.
 */
// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { fmtNum, fmtKB } from '../format.mjs';

describe('fmtNum', () => {
  it('renders null/undefined/NaN as an em dash', () => {
    expect(fmtNum(null)).toBe('—');
    expect(fmtNum(undefined)).toBe('—');
    expect(fmtNum(NaN)).toBe('—');
  });

  it('uses 0 decimals at 1000 and above', () => {
    expect(fmtNum(1234.5678)).toBe('1235');
    expect(fmtNum(1000)).toBe('1000');
  });

  it('uses 3 decimals between 1 and 999', () => {
    expect(fmtNum(18.019)).toBe('18.019');
    expect(fmtNum(1)).toBe('1.000');
  });

  it('uses 3 significant digits below 1', () => {
    expect(fmtNum(0.869)).toBe('0.869');
    expect(fmtNum(0.0001234)).toBe('0.000123');
  });

  it('appends the unit when given', () => {
    expect(fmtNum(16, '%')).toBe('16.000%');
  });
});

describe('fmtKB', () => {
  it('converts bytes to KiB', () => {
    expect(fmtKB(2048)).toBe('2.000');
    expect(fmtKB(9439)).toBe('9.218');
  });

  it('renders null/undefined/NaN as an em dash (same as fmtNum)', () => {
    expect(fmtKB(null)).toBe('—');
    expect(fmtKB(undefined)).toBe('—');
    expect(fmtKB(NaN)).toBe('—');
  });
});
