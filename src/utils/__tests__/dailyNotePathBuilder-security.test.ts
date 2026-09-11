/**
 * dailyNotePathBuilder-security.test.ts
 * dailyNotePathBuilderのセキュリティテスト
 * パートラバーサル攻撃対策の検証
 *
 * 修正後: 無効なパス入力はエラーをスローする
 */

import { buildDailyNotePath, sanitizePathComponent } from '../dailyNotePathBuilder.js';

describe('buildDailyNotePath - セキュリティテスト（パートラバーサル対策済み）', () => {
  const testDate = new Date('2026-02-07');

  describe('パートラバーサル攻撃のブロック', () => {
    it('blocks parent directory traversal (../)', () => {
      expect(() => buildDailyNotePath('../', testDate)).toThrow(
        'Invalid path component: path traversal detected'
      );
    });

    it('blocks multiple parent directory traversals (../../)', () => {
      expect(() => buildDailyNotePath('../../malicious/', testDate)).toThrow(
        'Invalid path component: path traversal detected'
      );
    });

    it('blocks current directory references (./)', () => {
      expect(() => buildDailyNotePath('./path', testDate)).toThrow(
        'Invalid path component: path traversal detected'
      );
    });

    it('blocks input containing a root path (/)', () => {
      expect(() => buildDailyNotePath('/absolute/path/YYYY-MM-DD', testDate)).toThrow(
        'Invalid path component: absolute path detected'
      );
    });

    it('blocks backslash (Windows separator) path traversal', () => {
      expect(() => buildDailyNotePath('malicious\\..\\path', testDate)).toThrow(
        'Invalid path component: path traversal detected'
      );
    });

    it('blocks paths starting with a backslash', () => {
      expect(() => buildDailyNotePath('\\windows\\path', testDate)).toThrow(
        'Invalid path component: absolute path detected'
      );
    });
  });

  describe('プロトコルスキーム注入攻撃のブロック', () => {
    it('blocks input with the https:// scheme (detected as path traversal since it contains ../)', () => {
      expect(() => buildDailyNotePath('https://evil.com/../../', testDate)).toThrow(
        'Invalid path component: path traversal detected'
      );
    });

    it('blocks input with the http:// scheme', () => {
      expect(() => buildDailyNotePath('http://evil.com/path', testDate)).toThrow(
        'Invalid path component: protocol scheme detected'
      );
    });

    it('blocks input with the ftp:// scheme', () => {
      expect(() => buildDailyNotePath('ftp://ftp.example.com/YYYY-MM-DD', testDate)).toThrow(
        'Invalid path component: protocol scheme detected'
      );
    });

    it('blocks input with the file:// scheme', () => {
      expect(() => buildDailyNotePath('file:///etc/passwd', testDate)).toThrow(
        'Invalid path component: protocol scheme detected'
      );
    });

    it('blocks input with the data:// scheme', () => {
      expect(() => buildDailyNotePath('data:text/plain,hello', testDate)).toThrow(
        'Invalid path component: protocol scheme detected'
      );
    });

    it('blocks input with the javascript:// scheme', () => {
      expect(() => buildDailyNotePath('javascript:void(0)', testDate)).toThrow(
        'Invalid path component: protocol scheme detected'
      );
    });
  });

  describe('特殊文字とエンコードの検証', () => {
    // URLエンコードされた文字は文字通り処理されるため、エラーにはならない
    // （ブラウザのURL APIなどがデコードするわけではないため）
    it('handles input with URL-encoded characters literally', () => {
      const result = buildDailyNotePath('%2e%2e/%2f', testDate);
      expect(result).toContain('%2e%2e');
      expect(result).toContain('%2f');
    });

    it('handles input that may contain null bytes', () => {
      const result = buildDailyNotePath('path%00', testDate);
      expect(result).toContain('%00');
    });

    it('handles input containing newline characters', () => {
      const result = buildDailyNotePath('path\nmalicious', testDate);
      expect(result).toContain('path');
      expect(result).toContain('malicious');
    });
  });

  describe('検証済みの安全な入力', () => {
    it('handles common paths correctly', () => {
      const result = buildDailyNotePath('journal/YYYY-MM-DD', testDate);
      expect(result).toBe('journal/2026-02-07');
    });

    it('returns only the date for empty input', () => {
      const result = buildDailyNotePath('', testDate);
      expect(result).toBe('2026-02-07');
    });

    it('returns only the date for null', () => {
      const result = buildDailyNotePath(null as unknown as string, testDate);
      expect(result).toBe('2026-02-07');
    });

    it('returns only the date for undefined', () => {
      const result = buildDailyNotePath(undefined as unknown as string, testDate);
      expect(result).toBe('2026-02-07');
    });

    it('replaces placeholders correctly', () => {
      const result = buildDailyNotePath('notes/YYYY/MM/DD', testDate);
      expect(result).toBe('notes/2026/02/07');
    });

    it('replaces the YYYY-MM-DD placeholder correctly', () => {
      const result = buildDailyNotePath('entries/YYYY-MM-DD', testDate);
      expect(result).toBe('entries/2026-02-07');
    });

    it('allows relative paths with dots that are not path traversal', () => {
      const result = buildDailyNotePath('.hidden/YYYY-MM-DD', testDate);
      expect(result).toBe('.hidden/2026-02-07');
    });

    it('allows paths with multiple dots that are not path traversal', () => {
      const result = buildDailyNotePath('my..dir/YYYY-MM-DD', testDate);
      expect(result).toBe('my..dir/2026-02-07');
    });

    it('allows paths containing dashes', () => {
      const result = buildDailyNotePath('my-folder/sub-folder/YYYY-MM-DD', testDate);
      expect(result).toBe('my-folder/sub-folder/2026-02-07');
    });

    it('allows paths containing underscores', () => {
      const result = buildDailyNotePath('my_folder/sub_folder/YYYY-MM-DD', testDate);
      expect(result).toBe('my_folder/sub_folder/2026-02-07');
    });

    it('allows paths containing Japanese characters', () => {
      const result = buildDailyNotePath('日記/YYYY-MM-DD', testDate);
      expect(result).toBe('日記/2026-02-07');
    });
  });

  describe('長い入力の検証', () => {
    it('handles very long paths', () => {
      const longPath = 'a'.repeat(1000);
      const result = buildDailyNotePath(longPath, testDate);
      expect(result.length).toBe(1000);
    });

    it('handles deeply nested structures', () => {
      const deepPath = 'a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t/u/v/w/x/y/z';
      const result = buildDailyNotePath(deepPath, testDate);
      expect(result).toBe(deepPath);
    });
  });

  describe('エッジケース', () => {
    it('handles a minimal valid path', () => {
      const result = buildDailyNotePath('a', testDate);
      expect(result).toBe('a');
    });

    it('handles paths with a trailing slash', () => {
      const result = buildDailyNotePath('journal/', testDate);
      expect(result).toBe('journal/');
    });

    it('handles paths with multiple slashes', () => {
      const result = buildDailyNotePath('a//b///c', testDate);
      expect(result).toBe('a//b///c');
    });

    it('handles paths containing spaces', () => {
      const result = buildDailyNotePath('my folder/YYYY-MM-DD', testDate);
      expect(result).toBe('my folder/2026-02-07');
    });
  });
});

describe('VULN-001: bare dot segments must be rejected (path traversal)', () => {
  it('rejects bare `..` as a path component', () => {
    // VULN-001 PoC payload: settings value `..` (no trailing separator).
    expect(() => sanitizePathComponent('..')).toThrow();
  });

  it('rejects bare `.` as a path component', () => {
    expect(() => sanitizePathComponent('.')).toThrow();
  });

  it('rejects dot segments padded with whitespace', () => {
    expect(() => sanitizePathComponent(' .. ')).toThrow();
  });

  it('never produces a URL that escapes /vault/ via dot-segment normalization', () => {
    let dailyPath: string;
    try {
      dailyPath = buildDailyNotePath('..');
    } catch {
      return; // thrown at the boundary = secure
    }
    const normalized = new URL(`https://127.0.0.1:27124/vault/${dailyPath}/2026-09-10.md`).toString();
    expect(normalized.includes('/vault/')).toBe(true);
  });

  it('still accepts legitimate path components', () => {
    expect(sanitizePathComponent('Daily Notes')).toBe('Daily Notes');
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