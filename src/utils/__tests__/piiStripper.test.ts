/**
 * piiStripper.test.ts
 * PIIデータをストリップするユーティリティ関数のテスト
 */

import { stripPiiFromMaskedItems, stripPiiFromMaskedItem } from '../../background/pipeline/piiBoundary.js';
import type { MaskedItem } from '../../messaging/types.js';

describe('stripPiiFromMaskedItems', () => {
  describe('基本機能', () => {
    it('removes the original field from a MaskedItem array', () => {
      const items: MaskedItem[] = [
        { type: 'email', original: 'test@example.com' },
        { type: 'creditCard', original: '1234-5678-9012-3456' }
      ];

      const result = stripPiiFromMaskedItems(items);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ type: 'email' });
      expect(result[1]).toEqual({ type: 'creditCard' });
      expect(result[0]).not.toHaveProperty('original');
      expect(result[1]).not.toHaveProperty('original');
    });

    it('returns string items unchanged', () => {
      const items: (string | MaskedItem)[] = [
        'email',
        { type: 'creditCard', original: '1234-5678-9012-3456' }
      ];

      const result = stripPiiFromMaskedItems(items);

      expect(result).toHaveLength(2);
      expect(result[0]).toBe('email');
      expect(result[1]).toEqual({ type: 'creditCard' });
    });

    it('handles empty arrays', () => {
      const items: MaskedItem[] = [];

      const result = stripPiiFromMaskedItems(items);

      expect(result).toEqual([]);
    });

    it('returns items without an original field unchanged', () => {
      // deliberately omits the `original` field to exercise the passthrough path
      const items = [
        { type: 'email' },
        { type: 'creditCard', position: 'body' }
      ] as unknown as MaskedItem[];

      const result = stripPiiFromMaskedItems(items);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ type: 'email' });
      expect(result[1]).toEqual({ type: 'creditCard', position: 'body' });
    });

    it('preserves position and index fields', () => {
      const items: MaskedItem[] = [
        { type: 'email', position: 'header', original: 'test@example.com', index: 1 },
        { type: 'creditCard', position: 'body', original: '1234-5678-9012-3456', index: 2 }
      ];

      const result = stripPiiFromMaskedItems(items);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ type: 'email', position: 'header', index: 1 });
      expect(result[1]).toEqual({ type: 'creditCard', position: 'body', index: 2 });
    });
  });

  describe('セキュリティ', () => {
    it('fully removes original fields containing PII data', () => {
      const items: MaskedItem[] = [
        { type: 'email', original: 'sensitive@example.com' },
        { type: 'myNumber', original: '123456789012' },
        { type: 'bankAccount', original: '1234567' }
      ];

      const result = stripPiiFromMaskedItems(items);

      // originalフィールドが含まれていないことを確認
      result.forEach(item => {
        expect(item).not.toHaveProperty('original');
      });

      // JSON.stringifyしてもoriginalフィールドが含まれないことを確認
      const jsonString = JSON.stringify(result);
      expect(jsonString).not.toContain('sensitive@example.com');
      expect(jsonString).not.toContain('123456789012');
      expect(jsonString).not.toContain('1234567');
    });

    it('processes many items efficiently', () => {
      const items: MaskedItem[] = Array.from({ length: 1000 }, (_, i) => ({
        type: 'email',
        original: `user${i}@example.com`
      }));

      const startTime = performance.now();
      const result = stripPiiFromMaskedItems(items);
      const endTime = performance.now();

      expect(result).toHaveLength(1000);
      expect(endTime - startTime).toBeLessThan(100); // 100ms以内で処理

      // originalフィールドが含まれていないことを確認
      result.forEach(item => {
        expect(item).not.toHaveProperty('original');
      });
    });
  });
});

describe('stripPiiFromMaskedItem', () => {
  it('removes the original field from a single MaskedItem', () => {
    const item: MaskedItem = { type: 'email', original: 'test@example.com' };

    const result = stripPiiFromMaskedItem(item);

    expect(result).toEqual({ type: 'email' });
    expect(result).not.toHaveProperty('original');
  });

  it('preserves position and index fields', () => {
    const item: MaskedItem = {
      type: 'email',
      position: 'header',
      original: 'test@example.com',
      index: 1
    };

    const result = stripPiiFromMaskedItem(item);

    expect(result).toEqual({ type: 'email', position: 'header', index: 1 });
  });

  it('returns items without an original field unchanged', () => {
    // deliberately omits the `original` field to exercise the passthrough path
    const item = { type: 'email', position: 'body' } as unknown as MaskedItem;

    const result = stripPiiFromMaskedItem(item);

    expect(result).toEqual({ type: 'email', position: 'body' });
  });
});
