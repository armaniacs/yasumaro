/**
 * dailyNotePathBuilder-security.test.ts
 * dailyNotePathBuilderのセキュリティテスト
 * 問題点2: URLパスサニタイズ不足の検証
 */

import { buildDailyNotePath } from '../dailyNotePathBuilder';

describe('buildDailyNotePath - セキュリティテスト（問題点2）', () => {
  const testDate = new Date('2026-02-07');

  describe('パストラバーサル攻撃の検証', () => {
    it('親ディレクトリ参照（../）を正しく処理する', () => {
      // これはpayloadとして使用されるため、プレースホルダーがない場合はそのまま返される
      const result = buildDailyNotePath('../', testDate);

      // 現在の実装では置換のみ行われるため、../が残る
      expect(result).toContain('../');
      // プレースホルダーがないため、日付は含まれない
      expect(result).not.toContain('2026-02-07');
    });

    it('複数の親ディレクトリ参照（../../）を処理する', () => {
      const result = buildDailyNotePath('../../malicious/', testDate);

      // file://やhttp://などのURLでの操作には危険
      expect(result).toContain('../');
      expect(result).toContain('malicious');
    });

    it('ルートパス（/）を含む入力を処理する', () => {
      const result = buildDailyNotePath('/absolute/path/YYYY-MM-DD', testDate);

      expect(result).toMatch(/^\//); // ルートから始まる
      expect(result).toContain('2026-02-07');
    });

    it('バックスラッシュ（Windowsパス区切り）を処理する', () => {
      const result = buildDailyNotePath('malicious\\..\\path', testDate);

      // バックスラッシュはJavaScript文字列内ではエスケープ文字だが、
      // ユーザー入力としては文字として扱われる
      expect(result).toContain('\\');
      expect(result).toContain('path');
    });
  });

  describe('URL操作攻撃の検証', () => {
    it('プロトコルスキームを含む入力を処理する', () => {
      const result = buildDailyNotePath('https://evil.com/../../', testDate);

      // 対象のURL構築に使用される危険
      expect(result).toContain('https://evil.com');
      expect(result).toContain('../');
    });

    it('ftp:// スキームを含む入力を処理する', () => {
      const result = buildDailyNotePath('ftp://ftp.example.com/YYYY-MM-DD', testDate);

      expect(result).toContain('ftp://ftp.example.com');
    });

    it('file:// スキームを含む入力を処理する', () => {
      const result = buildDailyNotePath('file:///etc/passwd', testDate);

      expect(result).toContain('file:///etc/passwd');
    });
  });

  describe('特殊文字とエンコードの検証', () => {
    it('URLエンコードされた文字を含む入力を処理する', () => {
      const result = buildDailyNotePath('%2e%2e/%2f', testDate);

      expect(result).toContain('%2e%2e'); // URLエンコードされた../
      expect(result).toContain('%2f'); // URLエンコードされた/
    });

    it('ヌルバイトを含む可能性のある入力を処理する', () => {
      const result = buildDailyNotePath('path%00', testDate);

      expect(result).toContain('%00');
    });

    it('改行文字を含む入力を処理する', () => {
      const result = buildDailyNotePath('path\nmalicious', testDate);

      expect(result).toContain('path');
      expect(result).toContain('malicious');
    });

    it('制御文字を含む入力を処理する', () => {
      const result = buildDailyNotePath('path\rmalicious', testDate);

      expect(result).toContain('path');
      expect(result).toContain('malicious');
    });
  });

  describe('検証済みの安全な入力', () => {
    it('一般的なパスを正しく処理する', () => {
      const result = buildDailyNotePath('journal/YYYY-MM-DD', testDate);

      expect(result).toBe('journal/2026-02-07');
    });

    it('空の入力に対して日付のみを返す', () => {
      const result = buildDailyNotePath('', testDate);

      expect(result).toBe('2026-02-07');
    });

    it('null/undefinedに対して日付のみを返す', () => {
      const result1 = buildDailyNotePath(null, testDate);
      const result2 = buildDailyNotePath(undefined, testDate);

      expect(result1).toBe('2026-02-07');
      expect(result2).toBe('2026-02-07');
    });

    it('プレースホルダーを正しく置換する', () => {
      const result = buildDailyNotePath('notes/YYYY/MM/DD', testDate);

      expect(result).toBe('notes/2026/02/07');
    });

    it('YYYY-MM-DDプレースホルダーを正しく置換する', () => {
      const result = buildDailyNotePath('entries/YYYY-MM-DD', testDate);

      expect(result).toBe('entries/2026-02-07');
    });
  });

  describe('長い入力の検証', () => {
    it('非常に長いパスを処理できる', () => {
      const longPath = 'a'.repeat(1000);
      const result = buildDailyNotePath(longPath, testDate);

      expect(result.length).toBeGreaterThan(100);
    });

    it('深い階層構造を処理できる', () => {
      const deepPath = 'a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t/u/v/w/x/y/z';
      const result = buildDailyNotePath(deepPath, testDate);

      // プレースホルダーがないため、変更なし
      expect(result).toBe(deepPath);
    });
  });
});

/**
 * セキュリティ問題点のまとめ:
 *
 * buildDailyNotePathは現在、ユーザー入力に対するサニタイズや検証を行っていません。
 *
 * 脆弱性:
 * 1. パストラバーサル攻撃 (../, ./) が可能
 * 2. プロトコルスキーム注入 (https://, ftp://, file://) が可能
 * 3. 特殊文字の検証がない
 * 4. URLエンコードされた攻撃の検証がない
 * 5. 絶対パス (/ で始まる) の検証がない
 *
 * obsidianClient.tsでの使用:
 * - // obsidianClient.ts:118-119
 * - const pathSegment = dailyPath ? `${dailyPath}/` : '';
 * - const targetUrl = `${baseUrl}/vault/${pathSegment}${buildDailyNotePath('')}.md`;
 *
 * 脆弱性の影響:
 * - URL構築時にパストラバーサル攻撃が可能になる可能性
 * - プロトコルスキーム注入でAPIエンドポイントが変更される可能性
 * - file://スキームでローカルファイル操作が可能になる可能性
 *
 * 推奨される修正:
 * 1. パスセグメントサニタイズ関数の追加
 * 2. 許可された文字のホワイトリスト検証
 * 3. パスコンポーネント（../）のブロック
 * 4. プロトコルスキームのブロック
 * 5. 上限長の設定
 */