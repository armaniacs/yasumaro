/**
 * pathSanitizer.test.ts
 * パスサニタイズ関数のテスト
 * 問題点2: URLパスサニタイズ不足の修正検証
 */

import { sanitizePathSegment, sanitizePathForUrl, encodePathForUrl } from '../pathSanitizer';

describe('sanitizePathSegment - セキュリティサニタイズ関数（問題点2の修正）', () => {
  describe('パストラバーサル攻撃のブロック', () => {
    it('親ディレクトリ参照（../）がエラーをスローする', () => {
      const input = '../malicious';

      expect(() => sanitizePathSegment(input)).toThrow('Path traversal attempt detected');
    });

    it('複数の親ディレクトリ参照（../../）がエラーをスローする', () => {
      const input = '../../malicious/path';

      expect(() => sanitizePathSegment(input)).toThrow('Path traversal attempt detected');
    });

    it('現在ディレクトリ参照（./）がエラーをスローする', () => {
      const input = './malicious';

      expect(() => sanitizePathSegment(input)).toThrow('Path traversal attempt detected');
    });

    it('ルートパス（/）から始まる入力は先頭のスラッシュを削除する', () => {
      const result = sanitizePathSegment('/absolute/path');

      expect(result).not.toMatch(/^\//);
      expect(result).toContain('absolute');
      expect(result).toContain('path');
    });
  });

  describe('プロトコルスキーム注入のブロック', () => {
    it('https:// スキームがエラーをスローする（../含むため）', () => {
      const input = 'https://evil.com/../path';

      expect(() => sanitizePathSegment(input)).toThrow('Path traversal attempt detected');
    });

    it('ftp:// スキームがエラーをスローする（含まれる文字が許可範囲外のため）', () => {
      const input = 'ftp://evil.com/path';

      expect(() => sanitizePathSegment(input)).toThrow();
    });

    it('file:// スキームがエラーをスローする（含まれる文字が許可範囲外のため）', () => {
      const input = 'file:///etc/passwd';

      expect(() => sanitizePathSegment(input)).toThrow();
    });
  });

  describe('特殊文字の制御', () => {
    it('ヌルバイトがエラーをスローする', () => {
      const input = 'path/with/\0/null';

      expect(() => sanitizePathSegment(input)).toThrow('Dangerous character detected in path');
    });

    it('改行文字がエラーをスローする', () => {
      const input = 'path/with\nnewline';

      expect(() => sanitizePathSegment(input)).toThrow('Dangerous character detected in path');
    });

    it('制御文字（\r）がエラーをスローする', () => {
      const input = 'path/\rmalicious';

      expect(() => sanitizePathSegment(input)).toThrow('Dangerous character detected in path');
    });
  });

  describe('安全な入力の維持', () => {
    it('正当なパス構造を維持する', () => {
      const result = sanitizePathSegment('journal/daily');

      expect(result).toBe('journal/daily');
    });

    it('スラッシュ区切りのパス構造を許可する', () => {
      const result = sanitizePathSegment('2024/01/15');

      expect(result).toBe('2024/01/15');
    });

    it('日本語を含むパスを許可する', () => {
      const result = sanitizePathSegment('日記/2024年/1月');

      expect(result).toBe('日記/2024年/1月');
    });

    it('ひらがなを含むパスを許可する', () => {
      const result = sanitizePathSegment('にっき/2月');

      expect(result).toBe('にっき/2月');
    });

    it('カタカナを含むパスを許可する', () => {
      const result = sanitizePathSegment('ニッキ/3月');

      expect(result).toBe('ニッキ/3月');
    });

    it('スペースを含むパスを許可する', () => {
      const result = sanitizePathSegment('my folder/path with spaces');

      expect(result).toBe('my folder/path with spaces');
    });
  });

  describe('エッジケース', () => {
    it('空文字列は空文字を返す', () => {
      const result = sanitizePathSegment('');

      expect(result).toBe('');
    });

    it('nullは空文字を返す', () => {
      const result = sanitizePathSegment(null);

      expect(result).toBe('');
    });

    it('undefinedは空文字を返す', () => {
      const result = sanitizePathSegment(undefined);

      expect(result).toBe('');
    });

    it('パス長制限を超える入力はエラーをスローする', () => {
      const longPath = 'a'.repeat(501);

      expect(() => sanitizePathSegment(longPath)).toThrow('Path length exceeds maximum limit');
    });

    it('セグメント数制限を超える入力はエラーをスローする', () => {
      const manySegments = 'a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t/u/v/w/x/y/z';

      expect(() => sanitizePathSegment(manySegments)).toThrow('Too many path segments');
    });
  });
});

describe('sanitizePathForUrl - URL用のセキュアパス生成', () => {
  describe('日付プレースホルダーとの連携', () => {
    it('YYYY-MM-DD形式のパスを正しく処理する', () => {
      const result = sanitizePathForUrl('journal/YYYY-MM-DD');

      expect(result).toBe('journal/YYYY-MM-DD');
    });
    it('別の日付形式のパスを正しく処理する', () => {
      const result = sanitizePathForUrl('notes/YYYY/MM/DD');

      expect(result).toBe('notes/YYYY/MM/DD');
    });

    it('プレースホルダーとパスサニタイズの組み合わせを処理できる', () => {
      const result = sanitizePathForUrl('../../notes/YYYY-MM-DD');

      // sanitizePathSegmentがエラーをスローするため、sanitizePathForUrlはエラーをキャッチして空文字を返す
      expect(result).toBe('');
    });
  });

  describe('複合的な攻撃の検証', () => {
    it('パストラバーサルとスキーム注入の組み合わせに対処する', () => {
      const input = 'https://evil.com/../../path';
      const result = sanitizePathForUrl(input);

      // ../を含むためエラーになり空文字を返す
      expect(result).toBe('');
    });

    it('URLエンコードされた特殊文字に対処する', () => {
      const input = '%2e%2e/%2f';
      const result = sanitizePathForUrl(input);

      // 検証: %文字は許可されないため、安全に拒否される
      expect(() => {
        sanitizePathSegment(input);
      }).toThrow();
    });
  });

  describe('日付プレースホルダー保護', () => {
    it('プレースホルダーが正しく保護される', () => {
      const result = sanitizePathForUrl('notes/YYYY-MM-DD');

      expect(result).toContain('YYYY-MM-DD');
      expect(result).not.toContain('__PLACEHOLDER_');
    });

    it('複数のプレースホルダーを正しく保護する', () => {
      const result = sanitizePathForUrl('notes/YYYY/MM/DD');

      expect(result).toContain('YYYY');
      expect(result).toContain('MM');
      expect(result).toContain('DD');
    });
  });
});

describe('encodePathForUrl - URLエンコード関数', () => {
  it('スラッシュを含むパスを正しくエンコードする', () => {
    const result = encodePathForUrl('path/with/slashes');

    expect(result).toBe('path%2Fwith%2Fslashes');
  });

  it('スペースを含むパスを正しくエンコードする', () => {
    const result = encodePathForUrl('path with spaces');

    expect(result).toBe('path%20with%20spaces');
  });

  it('日本語を含むパスを正しくエンコードする', () => {
    const result = encodePathForUrl('日記/2024年');

    expect(result).toContain('%E6%97%A5%E8%A8%98'); // 日記
    expect(result).toContain('2024'); // 2024
    expect(result).toContain('%E5%B9%B4'); // 年
  });

  it('空文字に対して空文字を返す', () => {
    const result = encodePathForUrl('');

    expect(result).toBe('');
  });

  it('nullに対して空文字を返す', () => {
    const result = encodePathForUrl(null);

    expect(result).toBe('');
  });
});

describe('既存コードとの統合検証', () => {
  it('buildDailyNotePathと組み合わせた統合テスト', async () => {
    const { buildDailyNotePath } = await import('../dailyNotePathBuilder');
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

  it('安全な入力は正常に処理される統合テスト', async () => {
    const { buildDailyNotePath } = await import('../dailyNotePathBuilder');
    const testDate = new Date('2026-02-07');

    // 安全な入力
    const safeInput = 'journal/YYYY-MM-DD';
    const sanitized = sanitizePathForUrl(safeInput);
    const result = buildDailyNotePath(sanitized, testDate);

    expect(sanitized).toBe(safeInput);
    expect(result).toBe('journal/2026-02-07');
  });

  it('dailyNotePathBuilder-security.test.tsの結果に基づいたテスト', () => {
    // ユーザー入力 '../../malicious/' をサニタイズして確認
    const dangerousInput = '../../malicious/';

    expect(() => sanitizePathSegment(dangerousInput)).toThrow('Path traversal attempt detected');
  });
});

describe('セキュリティテストまとめ', () => {
  it('パストラバーサル攻撃(../)をブロックすることを確認', () => {
    expect(() => sanitizePathSegment('../')).toThrow();
  });

  it('パストラバーサル攻撃(../../)をブロックすることを確認', () => {
    expect(() => sanitizePathSegment('../../')).toThrow();
  });

  it('パストラバーサル攻撃(../../../)をブロックすることを確認', () => {
    expect(() => sanitizePathSegment('../../../')).toThrow();
  });

  it('すべてのプロトコルスキーム注入をブロックすることを確認', () => {
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

  it('すべての制御文字をブロックすることを確認', () => {
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

  it('正当なパスはすべて通過することを確認', () => {
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