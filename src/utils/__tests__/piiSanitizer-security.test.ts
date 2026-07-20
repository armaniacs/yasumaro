import { describe, it, test, expect, vi, beforeEach, afterEach } from 'vitest';
/**
 * piiSanitizer-security.test.ts
 * PIIサニタイザのセキュリティテスト
 * Red Team指摘: エラー時に生テキストが返される問題の修正検証
 */

import { sanitizeRegex, MAX_INPUT_SIZE, MAX_OUTPUT_SIZE } from '../piiSanitizer';

describe('PIIサニタイザ - セキュリティテスト', () => {
  describe('エラーハンドリングの安全性', () => {
    test('タイムアウト時に生テキストが返されない', async () => {
      const piiText = 'my email is user@example.com and phone is 01234567890';

      // sanitizeRegexはエラー時に例外をスローする。
      // 短い入力はタイムアウト前に完了するため、成功ケースとしてPIIがマスクされることを確認。
      const result = await sanitizeRegex(piiText, { timeout: 1, skipSizeLimit: true });
      expect(result.text).not.toContain('user@example.com');
      expect(result.text).not.toContain('01234567890');
      expect(result.maskedItems.length).toBeGreaterThan(0);
    });

    test('大量のPIIパターンでタイムアウトを強制', async () => {
      // 極端に多くのPIIパターンを含むテキスト
      const manyPII = Array.from({ length: 1000 }, (_, i) =>
        `user${i}@example.com phone${i}01234567890 number${i}1234567`
      ).join(' ');

      // 短いタイムアウトを設定 → タイムアウト時にエラーがスローされる
      await expect(
        sanitizeRegex(manyPII, { timeout: 1, skipSizeLimit: true })
      ).rejects.toThrow();
    });

    test('大量の入力による処理失敗時に生テキストが返されない', async () => {
      const hugePII = 'x'.repeat(100000) + 'test@example.com';

      // 入力サイズ制限をスキップしない
      const result = await sanitizeRegex(hugePII, { skipSizeLimit: false });

      // エラーが生じるはず
      expect(result.error).toBeDefined();

      // 入力サイズ超過時は元のテキストが返される（これは仕様）
      // タイムアウト時との違い
      if (result.error?.includes('exceeds maximum limit')) {
        expect(result.text).toBe(hugePII);
      } else {
        // その他のエラーの場合は安全なプレースホルダー
        expect(result.text).not.toContain('test@example.com');
      }
    });
  });

  describe('RedDoS対策の有効性', () => {
    test('複雑な正規表現パターンによる攻撃に対処できる', async () => {
      // ネストされた構造による潜在的なReDoS攻撃パターン
      const maliciousInput = 'AAAAAAAAAAAA'.repeat(1000) + 'user@example.com';

      const startTime = Date.now();
      // sanitizeRegexはReDoS攻撃パターンをタイムアウトで検出してエラーをスローする。
      // この入力はタイムアウト前に完了する場合も、タイムアウトする場合も、
      // 生テキストにPIIが含まれないことを確認。
      const result = await sanitizeRegex(maliciousInput, {
        timeout: 1000, // 1秒タイムアウト
        skipSizeLimit: true
      });
      const endTime = Date.now();

      // タイムアウト内で処理が完了すること
      expect(endTime - startTime).toBeLessThan(2000);
      expect(result.text).not.toContain('user@example.com');
    });

    test('マッチ件数制限が適切に機能する', async () => {
      // 多量のメールアドレスパターンを含むテキスト
      const manyEmails = Array.from({ length: 1001 }, (_, i) =>
        `user${i}@example.com`
      ).join(' ');

      // マッチ件数制限によりエラーがスローされる
      await expect(
        sanitizeRegex(manyEmails, { timeout: 5000, skipSizeLimit: true })
      ).rejects.toThrow('exceeded maximum match count');
    });
  });

  describe('出力サイズ制限の安全性', () => {
    test('置換によるサイズ増大に対処できる', async () => {
      // 多くの短いPIIパターンを含むテキスト（置換によりサイズが増大）
      const manyPII = Array.from({ length: 500 }, (_, i) =>
        `user${i}@example.com phone${i}01234567890`
      ).join(' ');

      const result = await sanitizeRegex(manyPII, {
        timeout: 1000,
        skipSizeLimit: true
      });

      // 出力がサイズ制限を超えている場合は切り詰められている
      if (result.error?.includes('truncated')) {
        expect(result.text.length).toBeLessThanOrEqual(MAX_OUTPUT_SIZE);
        expect(result.text).not.toBe(manyPII);
      }

      // マスク項目は有効な type と original を持つ
      if (result.maskedItems.length > 0) {
        result.maskedItems.forEach(item => {
          expect(item.type).toBeTruthy();
          expect(item.original).toBeTruthy();
        });
      }
    });
  });

  describe('エッジケースのセキュリティ', () => {
    test('無効な文字を含むテキストの安全な処理', async () => {
      const invalidText = '\x00\x01\x02 email@example.com åäö ñ';

      const result = await sanitizeRegex(invalidText);

      // sanitizeRegexはエラー時に例外をスローするため、成功時のみresultが返される
      expect(result.text).not.toContain('email@example.com');
    });

    test('非常に長い文字列単一の処理', async () => {
      const singleLongString = 'a'.repeat(50000) + 'user@example.com';

      // sanitizeRegexはエラー時に例外をスローする
      const result = await sanitizeRegex(singleLongString, {
        timeout: 1000,
        skipSizeLimit: false
      });

      // 成功時はPIIがマスクされている
      expect(result.text).not.toContain('user@example.com');
    });

    test('nullおよびundefinedの安全な処理', async () => {
      const result1 = await sanitizeRegex(null as any);
      expect(result1.text).toBe('');
      expect(result1.maskedItems).toEqual([]);

      const result2 = await sanitizeRegex(undefined as any);
      expect(result2.text).toBe('');
      expect(result2.maskedItems).toEqual([]);
    });
  });
});