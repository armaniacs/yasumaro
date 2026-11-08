/**
 * backoff-batch-d.test.ts — PBI 2026-11-08-16 (item 7) pins.
 *
 * backoffDelayMs rejects nonsense inputs with a RangeError instead of
 * propagating NaN/Infinity/negative delays into sleep calls. The valid
 * series are pinned by backoff.test.ts and the adoption parity test —
 * this file pins only the new rejection boundary.
 */
import { describe, it, expect } from 'vitest';
import { backoffDelayMs } from '../backoff.js';

describe('backoffDelayMs input validation (PBI 2026-11-08-16 item 7)', () => {
  it('rejects negative, NaN, and infinite attempts', () => {
    expect(() => backoffDelayMs(-1)).toThrow(RangeError);
    expect(() => backoffDelayMs(NaN)).toThrow(RangeError);
    expect(() => backoffDelayMs(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => backoffDelayMs(Number.NEGATIVE_INFINITY)).toThrow(RangeError);
  });

  it('rejects negative or non-finite baseMs and multiplier', () => {
    expect(() => backoffDelayMs(0, { baseMs: -1 })).toThrow(RangeError);
    expect(() => backoffDelayMs(0, { baseMs: NaN })).toThrow(RangeError);
    expect(() => backoffDelayMs(0, { multiplier: -2 })).toThrow(RangeError);
    expect(() => backoffDelayMs(0, { multiplier: NaN })).toThrow(RangeError);
    expect(() => backoffDelayMs(0, { multiplier: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });

  it('rejects negative, NaN, and -Infinity maxMs but allows +Infinity (no cap)', () => {
    expect(() => backoffDelayMs(0, { maxMs: -1 })).toThrow(RangeError);
    expect(() => backoffDelayMs(0, { maxMs: NaN })).toThrow(RangeError);
    expect(() => backoffDelayMs(0, { maxMs: Number.NEGATIVE_INFINITY })).toThrow(RangeError);
    expect(backoffDelayMs(3, { baseMs: 100, maxMs: Number.POSITIVE_INFINITY })).toBe(800);
  });

  it('keeps computing valid series after the guard', () => {
    expect(backoffDelayMs(0)).toBe(1000);
    expect(backoffDelayMs(2, { baseMs: 100, multiplier: 2, maxMs: 1000 })).toBe(400);
  });
});
