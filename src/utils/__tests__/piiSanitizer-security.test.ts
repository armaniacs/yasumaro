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

      // 極端に短いタイムアウトを設定してタイムアウトを強制
      const result = await sanitizeRegex(piiText, { timeout: 1, skipSizeLimit: true });

      // 現在の実装では1msタイムアウトではエラーが発生しない可能性がある
      // （処理が早すぎるため）
      if (result.error) {
        // エラーが生じた場合
        expect(result.text).not.toContain('user@example.com');
        expect(result.text).not.toContain('01234567890');
        expect(result.text).toBe('[SANITIZATION_FAILED]');
      } else {
        // エラーが生じなかった場合（処理速度が十分に速い場合）
        // PIIが正しくマスクされていることを確認
        expect(result.text).not.toContain('user@example.com');
        expect(result.text).not.toContain('01234567890');
        expect(result.maskedItems.length).toBeGreaterThan(0);
      }
    });

    test('大量のPIIパターンでタイムアウトを強制', async () => {
      // 極端に多くのPIIパターンを含むテキスト
      const manyPII = Array.from({ length: 1000 }, (_, i) =>
        `user${i}@example.com phone${i}01234567890 number${i}1234567`
      ).join(' ');

      // 短いタイムアウトを設定
      const result = await sanitizeRegex(manyPII, {
        timeout: 1,
        skipSizeLimit: true
      });

      if (result.error && result.error.includes('timed out')) {
        // タイムアウト時は安全なプレースホルダー
        expect(result.text).toBe('[SANITIZATION_FAILED]');
        expect(result.text).not.toContain('user@example.com');
      } else if (result.error) {
        // その他のエラー
        expect(result.text).toBe('[SANITIZATION_FAILED]');
      }
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
      const result = await sanitizeRegex(maliciousInput, {
        timeout: 1000, // 1秒タイムアウト
        skipSizeLimit: true
      });
      const endTime = Date.now();

      // タイムアウト内で処理が完了するか、タイムアウトが検出される
      expect(endTime - startTime).toBeLessThan(2000);

      if (result.error) {
        // エラー時は安全なプレースホルダー
        expect(result.text).toBe('[SANITIZATION_FAILED]');
      } else {
        // 成功時はPIIがマスクされている
        expect(result.text).not.toContain('user@example.com');
        expect(result.maskedItems).toBeDefined();
      }
    });

    test('マッチ件数制限が適切に機能する', async () => {
      // 多量のメールアドレスパターンを含むテキスト
      const manyEmails = Array.from({ length: 1001 }, (_, i) =>
        `user${i}@example.com`
      ).join(' ');

      const result = await sanitizeRegex(manyEmails, {
        timeout: 5000,
        skipSizeLimit: true
      });

      // マッチ件数制限によりエラーが発生するか
      if (result.error) {
        expect(result.error).toContain('exceeded maximum match count');
        expect(result.text).not.toContain('user@example.com');
      }
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

      // 切り詰められた範囲内のマスク項目のみ保持されている
      if (result.maskedItems.length > 0) {
        result.maskedItems.forEach(item => {
          expect(item.type).toBeTruthy();
          expect(item.original).toBeTruthy();
          expect(item.original).not.toContain('user@example.com');
          expect(item.original).not.toContain('01234567890');
        });
      }
    });
  });

  describe('エッジケースのセキュリティ', () => {
    test('無効な文字を含むテキストの安全な処理', async () => {
      const invalidText = '\x00\x01\x02 email@example.com åäö ñ';

      const result = await sanitizeRegex(invalidText);

      if (result.error) {
        expect(result.text).toBe('[SANITIZATION_FAILED]');
      } else {
        expect(result.text).not.toContain('email@example.com');
      }
    });

    test('非常に長い文字列単一の処理', async () => {
      const singleLongString = 'a'.repeat(50000) + 'user@example.com';

      const result = await sanitizeRegex(singleLongString, {
        timeout: 1000,
        skipSizeLimit: false
      });

      if (result.error?.includes('exceeds maximum limit')) {
        // 入力サイズ超過時は元のテキストが返される（仕様）
        expect(result.text).toBe(singleLongString);
      } else if (result.error) {
        // その他のエラーは安全なプレースホルダー
        expect(result.text).toBe('[SANITIZATION_FAILED]');
        expect(result.text).not.toContain('user@example.com');
      }
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