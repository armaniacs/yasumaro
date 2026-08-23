import { describe, it, expect } from 'vitest';
import type { MaskedItem } from '../../../messaging/types.js';
import { toExternalResult } from '../piiBoundary.js';

describe('toExternalResult', () => {
  it('strips original from maskedItems', () => {
    const internal = {
      success: true as const,
      title: 't',
      url: 'https://example.com',
      maskedItems: [
        { type: 'email', original: 'test@example.com' } as MaskedItem,
        { type: 'creditCard', original: '1234-5678' } as MaskedItem,
      ],
    };
    const result = toExternalResult(internal);
    expect(result.maskedItems).toHaveLength(2);
    for (const item of result.maskedItems!) {
      expect(item).not.toHaveProperty('original');
    }
    expect(JSON.stringify(result)).not.toContain('test@example.com');
  });

  it('passes through string items', () => {
    const internal = {
      success: true as const,
      title: 't',
      url: 'https://example.com',
      maskedItems: ['email', { type: 'email', original: 'a@b.com' } as MaskedItem],
    };
    const result = toExternalResult(internal);
    expect(result.maskedItems![0]).toBe('email');
    expect(result.maskedItems![1]).not.toHaveProperty('original');
  });

  it('handles missing maskedItems', () => {
    const internal = { success: true as const, title: 't', url: 'https://example.com' };
    const result = toExternalResult(internal);
    expect(result.maskedItems).toBeUndefined();
  });

  it('is idempotent on already-stripped items', () => {
    const internal = {
      success: true as const,
      title: 't',
      url: 'https://example.com',
      maskedItems: [{ type: 'email' }],
    };
    const result = toExternalResult(internal);
    expect(result.maskedItems).toEqual([{ type: 'email' }]);
  });
});
