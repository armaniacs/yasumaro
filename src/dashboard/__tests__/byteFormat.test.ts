import { describe, it, expect } from 'vitest';
import { formatBytes } from '../byteFormat.js';

const KB = 1024;
const MB = KB * KB;
const GB = MB * KB;

describe('formatBytes (PBI 2026-09-25-07 policy SSOT)', () => {
  it('keeps sub-KB values as raw bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(800)).toBe('800 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('switches to KB at exactly 1 KB with 1 decimal', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('switches to MB and GB at the exact boundaries', () => {
    expect(formatBytes(2 * MB)).toBe('2.0 MB');
    expect(formatBytes(GB)).toBe('1.0 GB');
    expect(formatBytes(1.5 * GB)).toBe('1.5 GB');
  });

  it('rounds the fraction to 1 decimal', () => {
    expect(formatBytes(6000)).toBe('5.9 KB');
    expect(formatBytes(18000)).toBe('17.6 KB');
    expect(formatBytes(1280)).toBe('1.3 KB');
  });

  it('never prints a number that contradicts its unit', () => {
    // 1 byte under MB would read "1024.0 KB" if the unit were picked by a
    // plain magnitude threshold.
    expect(formatBytes(MB - 1)).toBe('1.0 MB');
    expect(formatBytes(GB - 1)).toBe('1.0 GB');
  });

  it('passes non-finite and negative inputs through (callers own the domain check)', () => {
    expect(formatBytes(-5)).toBe('-5 B');
    expect(formatBytes(-2048)).toBe('-2048 B');
    expect(formatBytes(Number.NaN)).toBe('NaN KB');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('Infinity GB');
  });
});
