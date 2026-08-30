import { describe, it, expect } from 'vitest';
import { clampLimit, buildQuerySpec, QUERY_CAPS } from '../queryPlan.js';

describe('clampLimit', () => {
  const cap = 1000;
  const fallback = 100;

  it('returns fallback for negative raw', () => {
    expect(clampLimit(-1, cap, fallback)).toBe(fallback);
  });

  it('returns fallback for zero', () => {
    expect(clampLimit(0, cap, fallback)).toBe(fallback);
  });

  it('returns fallback for non-integer raw', () => {
    expect(clampLimit(0.5, cap, fallback)).toBe(fallback);
  });

  it('returns fallback for non-finite raw', () => {
    expect(clampLimit(Infinity, cap, fallback)).toBe(fallback);
    expect(clampLimit(NaN, cap, fallback)).toBe(fallback);
  });

  it('returns fallback for non-number raw', () => {
    expect(clampLimit('50', cap, fallback)).toBe(fallback);
    expect(clampLimit(undefined, cap, fallback)).toBe(fallback);
    expect(clampLimit(null, cap, fallback)).toBe(fallback);
  });

  it('caps large raw at cap', () => {
    expect(clampLimit(1e9, cap, fallback)).toBe(cap);
  });

  it('passes a normal value through', () => {
    expect(clampLimit(50, cap, fallback)).toBe(50);
  });
});

describe('buildQuerySpec limit clamp', () => {
  it('clamps negative limit to the plain default (100)', () => {
    const spec = buildQuerySpec({ limit: -1 });
    expect(spec.limit).toBeGreaterThanOrEqual(1);
    expect(spec.limit).toBeLessThanOrEqual(QUERY_CAPS.plain);
    expect(spec.limit).toBe(100);
  });

  it('clamps 0.5 to default', () => {
    expect(buildQuerySpec({ limit: 0.5 }).limit).toBe(100);
  });

  it('caps 1e9 at the plain cap', () => {
    expect(buildQuerySpec({ limit: 1e9 }).limit).toBe(QUERY_CAPS.plain);
  });

  it('passes 50 through', () => {
    expect(buildQuerySpec({ limit: 50 }).limit).toBe(50);
  });
});
