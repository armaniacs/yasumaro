/**
 * pathSanitizer.test.ts
 * パスサニタイズ関数のテスト
 * 問題点2: URLパスサニタイズ不足の修正検証
 */

import { sanitizePathSegment, sanitizePathForUrl, encodePathForUrl, resolveSafeExportDir } from '../pathSanitizer.js';

describe('sanitizePathSegment - セキュリティサニタイズ関数（問題点2の修正）', () => {
  describe('パストラバーサル攻撃のブロック', () => {
    it('throws for parent directory references (../)', () => {
      const input = '../malicious';

      expect(() => sanitizePathSegment(input)).toThrow('Path traversal attempt detected');
    });

    it('throws for multiple parent directory references (../../)', () => {
      const input = '../../malicious/path';

      expect(() => sanitizePathSegment(input)).toThrow('Path traversal attempt detected');
    });

    it('throws for current directory references (./)', () => {
      const input = './malicious';

      expect(() => sanitizePathSegment(input)).toThrow('Path traversal attempt detected');
    });

    it('strips the leading slash from root-path (/) input', () => {
      const result = sanitizePathSegment('/absolute/path');

      expect(result).not.toMatch(/^\//);
      expect(result).toContain('absolute');
      expect(result).toContain('path');
    });
  });

  describe('プロトコルスキーム注入のブロック', () => {
    it('throws for the https:// scheme (contains ../)', () => {
      const input = 'https://evil.com/../path';

      expect(() => sanitizePathSegment(input)).toThrow('Path traversal attempt detected');
    });

    it('throws for the ftp:// scheme (contains out-of-range characters)', () => {
      const input = 'ftp://evil.com/path';

      expect(() => sanitizePathSegment(input)).toThrow();
    });

    it('throws for the file:// scheme (contains out-of-range characters)', () => {
      const input = 'file:///etc/passwd';

      expect(() => sanitizePathSegment(input)).toThrow();
    });
  });

  describe('特殊文字の制御', () => {
    it('throws for null bytes', () => {
      const input = 'path/with/\0/null';

      expect(() => sanitizePathSegment(input)).toThrow('Dangerous character detected in path');
    });

    it('throws for newline characters', () => {
      const input = 'path/with\nnewline';

      expect(() => sanitizePathSegment(input)).toThrow('Dangerous character detected in path');
    });

    it('throws for control characters (\r)', () => {
      const input = 'path/\rmalicious';

      expect(() => sanitizePathSegment(input)).toThrow('Dangerous character detected in path');
    });
  });

  describe('安全な入力の維持', () => {
    it('preserves a valid path structure', () => {
      const result = sanitizePathSegment('journal/daily');

      expect(result).toBe('journal/daily');
    });

    it('allows slash-separated path structures', () => {
      const result = sanitizePathSegment('2024/01/15');

      expect(result).toBe('2024/01/15');
    });

    it('allows paths containing Japanese', () => {
      const result = sanitizePathSegment('日記/2024年/1月');

      expect(result).toBe('日記/2024年/1月');
    });

    it('allows paths containing hiragana', () => {
      const result = sanitizePathSegment('にっき/2月');

      expect(result).toBe('にっき/2月');
    });

    it('allows paths containing katakana', () => {
      const result = sanitizePathSegment('ニッキ/3月');

      expect(result).toBe('ニッキ/3月');
    });

    it('allows paths containing spaces', () => {
      const result = sanitizePathSegment('my folder/path with spaces');

      expect(result).toBe('my folder/path with spaces');
    });
  });

  describe('エッジケース', () => {
    it('returns an empty string for empty input', () => {
      const result = sanitizePathSegment('');

      expect(result).toBe('');
    });

    it('returns an empty string for null', () => {
      const result = sanitizePathSegment(null as unknown as string);

      expect(result).toBe('');
    });

    it('returns an empty string for undefined', () => {
      const result = sanitizePathSegment(undefined as unknown as string);

      expect(result).toBe('');
    });

    it('throws for input exceeding the path length limit', () => {
      const longPath = 'a'.repeat(501);

      expect(() => sanitizePathSegment(longPath)).toThrow('Path length exceeds maximum limit');
    });

    it('throws for input exceeding the segment count limit', () => {
      const manySegments = 'a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t/u/v/w/x/y/z';

      expect(() => sanitizePathSegment(manySegments)).toThrow('Too many path segments');
    });
  });
});

describe('sanitizePathForUrl - URL用のセキュアパス生成', () => {
  describe('日付プレースホルダーとの連携', () => {
    it('handles YYYY-MM-DD paths correctly', () => {
      const result = sanitizePathForUrl('journal/YYYY-MM-DD');

      expect(result).toBe('journal/YYYY-MM-DD');
    });
    it('handles other date-format paths correctly', () => {
      const result = sanitizePathForUrl('notes/YYYY/MM/DD');

      expect(result).toBe('notes/YYYY/MM/DD');
    });

    it('handles combined placeholders and path sanitization', () => {
      const result = sanitizePathForUrl('../../notes/YYYY-MM-DD');

      // sanitizePathSegmentがエラーをスローするため、sanitizePathForUrlはエラーをキャッチして空文字を返す
      expect(result).toBe('');
    });
  });

  describe('複合的な攻撃の検証', () => {
    it('handles combined path traversal and scheme injection', () => {
      const input = 'https://evil.com/../../path';
      const result = sanitizePathForUrl(input);

      // ../を含むためエラーになり空文字を返す
      expect(result).toBe('');
    });

    it('handles URL-encoded special characters', () => {
      const input = '%2e%2e/%2f';
      const result = sanitizePathForUrl(input);

      // 検証: %文字は許可されないため、安全に拒否される
      expect(() => {
        sanitizePathSegment(input);
      }).toThrow();
    });
  });

  describe('日付プレースホルダー保護', () => {
    it('protects placeholders correctly', () => {
      const result = sanitizePathForUrl('notes/YYYY-MM-DD');

      expect(result).toContain('YYYY-MM-DD');
      expect(result).not.toContain('__PLACEHOLDER_');
    });

    it('protects multiple placeholders correctly', () => {
      const result = sanitizePathForUrl('notes/YYYY/MM/DD');

      expect(result).toContain('YYYY');
      expect(result).toContain('MM');
      expect(result).toContain('DD');
    });
  });
});

describe('encodePathForUrl - URLエンコード関数', () => {
  it('encodes paths containing slashes correctly', () => {
    const result = encodePathForUrl('path/with/slashes');

    expect(result).toBe('path%2Fwith%2Fslashes');
  });

  it('encodes paths containing spaces correctly', () => {
    const result = encodePathForUrl('path with spaces');

    expect(result).toBe('path%20with%20spaces');
  });

  it('encodes paths containing Japanese correctly', () => {
    const result = encodePathForUrl('日記/2024年');

    expect(result).toContain('%E6%97%A5%E8%A8%98'); // 日記
    expect(result).toContain('2024'); // 2024
    expect(result).toContain('%E5%B9%B4'); // 年
  });

  it('returns an empty string for empty input', () => {
    const result = encodePathForUrl('');

    expect(result).toBe('');
  });

  it('returns an empty string for null', () => {
    const result = encodePathForUrl(null as unknown as string);

    expect(result).toBe('');
  });
});

describe('既存コードとの統合検証', () => {
  it('integrates with buildDailyNotePath', async () => {
    const { buildDailyNotePath } = await import('../dailyNotePathBuilder.js');
    const testDate = new Date('2026-02-07');

    // 危険な入力をサニタイズしてから使用
    const dangerousInput = '../../../malicious/path/../../';
    const sanitized = sanitizePathForUrl(dangerousInput);
    const result = buildDailyNotePath(sanitized, testDate);

    // サニタイズしてはじかれたため、空文字になっているはず
    expect(sanitized).toBe('');
    // 結果は日付のみ
    expect(result).toBe('2026-02-07');
  });

  it('processes safe input normally in integration', async () => {
    const { buildDailyNotePath } = await import('../dailyNotePathBuilder.js');
    const testDate = new Date('2026-02-07');

    // 安全な入力
    const safeInput = 'journal/YYYY-MM-DD';
    const sanitized = sanitizePathForUrl(safeInput);
    const result = buildDailyNotePath(sanitized, testDate);

    expect(sanitized).toBe(safeInput);
    expect(result).toBe('journal/2026-02-07');
  });

  it('reproduces the dailyNotePathBuilder-security.test.ts cases', () => {
    // ユーザー入力 '../../malicious/' をサニタイズして確認
    const dangerousInput = '../../malicious/';

    expect(() => sanitizePathSegment(dangerousInput)).toThrow('Path traversal attempt detected');
  });
});

describe('セキュリティテストまとめ', () => {
  it('blocks path traversal attacks (../)', () => {
    expect(() => sanitizePathSegment('../')).toThrow();
  });

  it('blocks path traversal attacks (../../)', () => {
    expect(() => sanitizePathSegment('../../')).toThrow();
  });

  it('blocks path traversal attacks (../../../)', () => {
    expect(() => sanitizePathSegment('../../../')).toThrow();
  });

  it('blocks all protocol scheme injections', () => {
    const schemeAttacks: string[] = [
      'https://evil.com/path',
      'http://evil.com/path',
      'ftp://evil.com/path',
      'file:///etc/passwd',
      'data:text/html,<script>',
      'javascript:alert(1)',
      'vbscript:msgbox(1)',
    ];

    schemeAttacks.forEach(attack => {
      expect(() => sanitizePathSegment(attack)).toThrow();
    });
  });

  it('blocks all control characters', () => {
    const controlCharAttacks: string[] = [
      'path/\0null',
      'path\nwith\nnewlines',
      'path\rmalicious',
      'path\x00null',
      'path\x1Finvalid',
    ];

    controlCharAttacks.forEach(attack => {
      expect(() => sanitizePathSegment(attack as any)).toThrow();
    });
  });

  it('passes all valid paths', () => {
    const validPaths: string[] = [
      'journal',
      'journal/daily',
      '2024/01/15',
      '日記/2024年',
      'with spaces',
      'with_punctuation!',
      'notes/YYYY-MM-DD',
      'entries/YYYY/MM/DD',
    ];

    validPaths.forEach(path => {
      const result = sanitizePathSegment(path);
      expect(result).toBeTruthy();
    });
  });
});
describe('resolveSafeExportDir - PBI 27 ダウンロード filename ガード', () => {
  it('keeps a valid export directory unchanged', () => {
    expect(resolveSafeExportDir('Yasumaro')).toBe('Yasumaro');
    expect(resolveSafeExportDir('MyExport')).toBe('MyExport');
  });

  it('replaces traversal attempts with the fallback', () => {
    expect(resolveSafeExportDir('../evil')).toBe('Yasumaro');
    expect(resolveSafeExportDir('../../etc/passwd')).toBe('Yasumaro');
  });

  it('replaces input with control characters by the fallback', () => {
    expect(resolveSafeExportDir('evil\npath')).toBe('Yasumaro');
    expect(resolveSafeExportDir('a\x00b')).toBe('Yasumaro');
  });

  it('replaces empty or whitespace-only input with the fallback', () => {
    expect(resolveSafeExportDir('')).toBe('Yasumaro');
    expect(resolveSafeExportDir('   ')).toBe('Yasumaro');
  });

  it('uses a custom fallback', () => {
    expect(resolveSafeExportDir('../evil', 'Fallback')).toBe('Fallback');
  });
});
