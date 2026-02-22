/**
 * dailyNotePathBuilder-security.test.ts
 * dailyNotePathBuilderのセキュリティテスト
 * パートラバーサル攻撃対策の検証
 *
 * 修正後: 無効なパス入力はエラーをスローする
 */

import { buildDailyNotePath } from '../dailyNotePathBuilder.js';

describe('buildDailyNotePath - セキュリティテスト（パートラバーサル対策済み）', () => {
  const testDate = new Date('2026-02-07');

  describe('パートラバーサル攻撃のブロック', () => {
    it('親ディレクトリ参照（../）をブロックする', () => {
      expect(() => buildDailyNotePath('../', testDate)).toThrow(
        'Invalid path component: path traversal detected'
      );
    });

    it('複数の親ディレクトリ参照（../../）をブロックする', () => {
      expect(() => buildDailyNotePath('../../malicious/', testDate)).toThrow(
        'Invalid path component: path traversal detected'
      );
    });

    it('現在ディレクトリ参照（./）をブロックする', () => {
      expect(() => buildDailyNotePath('./path', testDate)).toThrow(
        'Invalid path component: path traversal detected'
      );
    });

    it('ルートパス（/）を含む入力をブロックする', () => {
      expect(() => buildDailyNotePath('/absolute/path/YYYY-MM-DD', testDate)).toThrow(
        'Invalid path component: absolute path detected'
      );
    });

    it('バックスラッシュ（Windowsパス区切り）形式のパートラバーサルをブロックする', () => {
      expect(() => buildDailyNotePath('malicious\\..\\path', testDate)).toThrow(
        'Invalid path component: path traversal detected'
      );
    });

    it('バックスラッシュで始まるパスをブロックする', () => {
      expect(() => buildDailyNotePath('\\windows\\path', testDate)).toThrow(
        'Invalid path component: absolute path detected'
      );
    });
  });

  describe('プロトコルスキーム注入攻撃のブロック', () => {
    it('https:// スキームを含む入力をブロックする（../も含むためパートラバーサル検出）', () => {
      expect(() => buildDailyNotePath('https://evil.com/../../', testDate)).toThrow(
        'Invalid path component: path traversal detected'
      );
    });

    it('http:// スキームを含む入力をブロックする', () => {
      expect(() => buildDailyNotePath('http://evil.com/path', testDate)).toThrow(
        'Invalid path component: protocol scheme detected'
      );
    });

    it('ftp:// スキームを含む入力をブロックする', () => {
      expect(() => buildDailyNotePath('ftp://ftp.example.com/YYYY-MM-DD', testDate)).toThrow(
        'Invalid path component: protocol scheme detected'
      );
    });

    it('file:// スキームを含む入力をブロックする', () => {
      expect(() => buildDailyNotePath('file:///etc/passwd', testDate)).toThrow(
        'Invalid path component: protocol scheme detected'
      );
    });

    it('data:// スキームを含む入力をブロックする', () => {
      expect(() => buildDailyNotePath('data:text/plain,hello', testDate)).toThrow(
        'Invalid path component: protocol scheme detected'
      );
    });

    it('javascript:// スキームを含む入力をブロックする', () => {
      expect(() => buildDailyNotePath('javascript:void(0)', testDate)).toThrow(
        'Invalid path component: protocol scheme detected'
      );
    });
  });

  describe('特殊文字とエンコードの検証', () => {
    // URLエンコードされた文字は文字通り処理されるため、エラーにはならない
    // （ブラウザのURL APIなどがデコードするわけではないため）
    it('URLエンコードされた文字を含む入力を処理する（文字通り）', () => {
      const result = buildDailyNotePath('%2e%2e/%2f', testDate);
      expect(result).toContain('%2e%2e');
      expect(result).toContain('%2f');
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

    it('nullに対して日付のみを返す', () => {
      const result = buildDailyNotePath(null as unknown as string, testDate);
      expect(result).toBe('2026-02-07');
    });

    it('undefinedに対して日付のみを返す', () => {
      const result = buildDailyNotePath(undefined as unknown as string, testDate);
      expect(result).toBe('2026-02-07');
    });

    it('プレースホルダーを正しく置換する', () => {
      const result = buildDailyNotePath('notes/YYYY/MM/DD', testDate);
      expect(result).toBe('notes/2026/02/07');
    });

    it('YYYY-MM-DDプレースホルダーを正しく置換する', () => {
      const result = buildDailyNotePath('entries/YYYY-MM-DD', testDate);
      expect(result).toBe('entries/2026-02-07');
    });

    it('ドットを含む相対パス（ただしパートラバーサルでない）を許可する', () => {
      const result = buildDailyNotePath('.hidden/YYYY-MM-DD', testDate);
      expect(result).toBe('.hidden/2026-02-07');
    });

    it('複数のドットを含むパス（ただしパートラバーサルでない）を許可する', () => {
      const result = buildDailyNotePath('my..dir/YYYY-MM-DD', testDate);
      expect(result).toBe('my..dir/2026-02-07');
    });

    it('ダッシュを含むパスを許可する', () => {
      const result = buildDailyNotePath('my-folder/sub-folder/YYYY-MM-DD', testDate);
      expect(result).toBe('my-folder/sub-folder/2026-02-07');
    });

    it('アンダースコアを含むパスを許可する', () => {
      const result = buildDailyNotePath('my_folder/sub_folder/YYYY-MM-DD', testDate);
      expect(result).toBe('my_folder/sub_folder/2026-02-07');
    });

    it('日本語を含むパスを許可する', () => {
      const result = buildDailyNotePath('日記/YYYY-MM-DD', testDate);
      expect(result).toBe('日記/2026-02-07');
    });
  });

  describe('長い入力の検証', () => {
    it('非常に長いパスを処理できる', () => {
      const longPath = 'a'.repeat(1000);
      const result = buildDailyNotePath(longPath, testDate);
      expect(result.length).toBe(1000);
    });

    it('深い階層構造を処理できる', () => {
      const deepPath = 'a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t/u/v/w/x/y/z';
      const result = buildDailyNotePath(deepPath, testDate);
      expect(result).toBe(deepPath);
    });
  });

  describe('エッジケース', () => {
    it('最小限の有効なパスを処理する', () => {
      const result = buildDailyNotePath('a', testDate);
      expect(result).toBe('a');
    });

    it('末尾のスラッシュを含むパスを処理する', () => {
      const result = buildDailyNotePath('journal/', testDate);
      expect(result).toBe('journal/');
    });

    it('複数のスラッシュを含むパスを処理する', () => {
      const result = buildDailyNotePath('a//b///c', testDate);
      expect(result).toBe('a//b///c');
    });

    it('スペースを含むパスを処理する', () => {
      const result = buildDailyNotePath('my folder/YYYY-MM-DD', testDate);
      expect(result).toBe('my folder/2026-02-07');
    });
  });
});

/**
 * セキュリティ対策のまとめ（修正後）:
 *
 * buildDailyNotePathは以下のセキュリティ対策を実装:
 *
 * 1. パートラバーサル攻撃 (../, ./, ..\, .\) はブロック
 * 2. プロトコルスキーム注入 (https://, file://, ftp://, javascript://, data://) はブロック
 * 3. 絶対パス (/ または \ で始まるパス) はブロック
 *
 * 許可される入力:
 * - 相対パス (e.g., "journal/", "notes/YYYY/MM/DD")
 * - ドットを含むファイル名 (e.g., ".hidden")
 * - 日本語やその他のUnicode文字
 * - 特殊文字（スラッシュ、ダッシュ、アンダースコアなど）
 *
 * obsidianClient.tsでの使用:
 * - obsidianClient.ts:180: const pathSegment = dailyPath ? `${dailyPath}/` : '';
 * - obsidianClient.ts:181: const targetUrl = `${baseUrl}/vault/${pathSegment}${buildDailyNotePath('')}.md`;
 *
 * セキュリティ保障:
 * - パートラバーサル攻撃により /vault/ ディレクトリ外へのアクセス防止
 * - プロトコルスキーム注入によりAPIエンドポイントの変更防止
 * - file:// スキームによるローカルファイル操作防止
 */