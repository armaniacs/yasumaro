/**
 * piiStripper.test.ts
 * PIIデータをストリップするユーティリティ関数のテスト
 */

import { stripPiiFromMaskedItems, stripPiiFromMaskedItem } from '../piiStripper.js';
import type { MaskedItem } from '../../messaging/types.js';

describe('stripPiiFromMaskedItems', () => {
  describe('基本機能', () => {
    it('MaskedItem配列からoriginalフィールドを削除できる', () => {
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

    it('string型のアイテムはそのまま返す', () => {
      const items: (string | MaskedItem)[] = [
        'email',
        { type: 'creditCard', original: '1234-5678-9012-3456' }
      ];

      const result = stripPiiFromMaskedItems(items);

      expect(result).toHaveLength(2);
      expect(result[0]).toBe('email');
      expect(result[1]).toEqual({ type: 'creditCard' });
    });

    it('空配列を処理できる', () => {
      const items: MaskedItem[] = [];

      const result = stripPiiFromMaskedItems(items);

      expect(result).toEqual([]);
    });

    it('originalフィールドがないアイテムはそのまま返す', () => {
      const items: MaskedItem[] = [
        { type: 'email' },
        { type: 'creditCard', position: 'body' }
      ];

      const result = stripPiiFromMaskedItems(items);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ type: 'email' });
      expect(result[1]).toEqual({ type: 'creditCard', position: 'body' });
    });

    it('positionとindexフィールドは保持される', () => {
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
    it('PIIデータが含まれるoriginalフィールドが完全に削除される', () => {
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

    it('大量のアイテムを効率的に処理できる', () => {
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
  it('単一のMaskedItemからoriginalフィールドを削除できる', () => {
    const item: MaskedItem = { type: 'email', original: 'test@example.com' };

    const result = stripPiiFromMaskedItem(item);

    expect(result).toEqual({ type: 'email' });
    expect(result).not.toHaveProperty('original');
  });

  it('positionとindexフィールドは保持される', () => {
    const item: MaskedItem = {
      type: 'email',
      position: 'header',
      original: 'test@example.com',
      index: 1
    };

    const result = stripPiiFromMaskedItem(item);

    expect(result).toEqual({ type: 'email', position: 'header', index: 1 });
  });

  it('originalフィールドがないアイテムはそのまま返す', () => {
    const item: MaskedItem = { type: 'email', position: 'body' };

    const result = stripPiiFromMaskedItem(item);

    expect(result).toEqual({ type: 'email', position: 'body' });
  });
});
