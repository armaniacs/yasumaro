/**
 * aiDomainPolicy.test.ts
 *
 * Table test for the per-domain egress policy resolver (PBI 2026-10-23-01,
 * fail-closed to `no-summary` per PBI 2026-11-24-19).
 * A missing row, a URL without a domain, and a corrupted *map* still resolve
 * to `allowed` (the map is an opt-in restriction, so garbage must not expand
 * it into "every domain denied"). A present row with an unknown/corrupt
 * *value* fails closed to `no-summary` (no-send side), so a broken value can
 * never widen egress to unrestricted send.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveAiDomainPolicy,
  normalizeAiDomainPolicy,
  normalizeAiDomainPolicyMap,
} from '../aiDomainPolicy.js';
import { AI_DOMAIN_POLICIES } from '../types.js';
import type { AiDomainPolicy } from '../types.js';

describe('AI_DOMAIN_POLICIES', () => {
  it('enumerates exactly the three policy choices', () => {
    expect(AI_DOMAIN_POLICIES).toEqual(['allowed', 'no-summary', 'mask-required']);
  });
});

describe('normalizeAiDomainPolicy', () => {
  it.each([
    ['allowed', 'allowed'],
    ['no-summary', 'no-summary'],
    ['mask-required', 'mask-required'],
  ])('passes the legal value %s through', (value, expected) => {
    expect(normalizeAiDomainPolicy(value)).toBe(expected);
  });

  it.each([
    ['garbage_policy', 'garbage_policy'],
    ['number 1', 1],
    ['undefined', undefined],
    ['null', null],
    ['trailing space', 'mask-required '],
    ['uppercase', 'NO-SUMMARY'],
    ['empty string', ''],
  ])('fails closed to no-summary for %s', (_label, value) => {
    expect(normalizeAiDomainPolicy(value)).toBe('no-summary');
  });
});

describe('normalizeAiDomainPolicyMap', () => {
  it('normalizes every row and keeps unknown domains out', () => {
    const map = normalizeAiDomainPolicyMap({
      'example.com': 'mask-required',
      'other.com': 'corrupt_value',
    });
    expect(map).toEqual({ 'example.com': 'mask-required', 'other.com': 'no-summary' });
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['array', ['example.com']],
    ['string', 'example.com'],
  ])('falls through to an empty map for %s', (_label, value) => {
    expect(normalizeAiDomainPolicyMap(value)).toEqual({});
  });
});

describe('resolveAiDomainPolicy', () => {
  const SETTINGS = (map: unknown) => ({ ai_domain_policy: map }) as never;

  it.each([
    ['mask-required row resolves', { 'example.com': 'mask-required' }, 'https://example.com/page', 'mask-required'],
    ['no-summary row resolves', { 'example.com': 'no-summary' }, 'https://example.com/page', 'no-summary'],
    ['allowed row resolves', { 'example.com': 'allowed' }, 'https://example.com/page', 'allowed'],
  ] as const)('%s', (_label, map, url, expected) => {
    expect(resolveAiDomainPolicy(SETTINGS(map), url)).toBe(expected);
  });

  it('resolves a domain without a row to allowed', () => {
    expect(resolveAiDomainPolicy(SETTINGS({ 'other.com': 'mask-required' }), 'https://example.com/page')).toBe('allowed');
  });

  it('resolves a URL without a domain to allowed', () => {
    expect(resolveAiDomainPolicy(SETTINGS({ 'example.com': 'mask-required' }), '')).toBe('allowed');
  });

  it('resolves a corrupted map to allowed (opt-in restriction, garbage must not expand it)', () => {
    expect(resolveAiDomainPolicy(SETTINGS('corrupt'), 'https://example.com/page')).toBe('allowed');
  });

  it.each([
    ['trailing space', 'mask-required '],
    ['uppercase', 'NO-SUMMARY'],
    ['null', null],
    ['garbage', 'corrupt_value'],
  ])('resolves a present but corrupt row to no-summary for %s', (_label, value) => {
    expect(
      resolveAiDomainPolicy(SETTINGS({ 'example.com': value }), 'https://example.com/page'),
    ).toBe('no-summary');
  });

  it('resolves a missing map to allowed', () => {
    expect(resolveAiDomainPolicy(SETTINGS(undefined), 'https://example.com/page')).toBe('allowed');
  });
});
