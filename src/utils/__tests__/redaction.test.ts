/**
 * redaction.ts のテスト
 */

import { redactSensitiveData, redactHeaderValue, consoleSecureError, SENSITIVE_HEADER_REASONS } from '../redaction.js';

describe('redactHeaderValue', () => {
  describe('authorization reason', () => {
    it('authorization の場合は [REDACTED] を返す', () => {
      expect(redactHeaderValue('Bearer secret-token-abc123', 'authorization')).toBe('[REDACTED]');
    });

    it('空文字列の authorization でも [REDACTED] を返す', () => {
      expect(redactHeaderValue('', 'authorization')).toBe('[REDACTED]');
    });
  });

  describe('非機密 reason', () => {
    it('cache-control の場合は元の値をそのまま返す', () => {
      expect(redactHeaderValue('private, no-store', 'cache-control')).toBe('private, no-store');
    });

    it('set-cookie の場合は元の値をそのまま返す', () => {
      expect(redactHeaderValue('session=abc; HttpOnly', 'set-cookie')).toBe('session=abc; HttpOnly');
    });

    it('未知の reason の場合は元の値をそのまま返す', () => {
      expect(redactHeaderValue('some-value', 'unknown-reason')).toBe('some-value');
    });

    it('空文字列 reason の場合は元の値をそのまま返す', () => {
      expect(redactHeaderValue('some-value', '')).toBe('some-value');
    });
  });

  describe('SENSITIVE_HEADER_REASONS', () => {
    it('authorization が含まれている', () => {
      expect(SENSITIVE_HEADER_REASONS).toContain('authorization');
    });
  });
});

describe('redactSensitiveData', () => {
  it('APIキーフィールドを [REDACTED] に置換する', () => {
    const data = {
      obsidian_api_key: 'secret123',
      gemini_api_key: 'key456',
      name: 'test'
    };
    const result = redactSensitiveData(data) as Record<string, unknown>;
    expect(result.obsidian_api_key).toBe('[REDACTED]');
    expect(result.gemini_api_key).toBe('[REDACTED]');
    expect(result.name).toBe('test');
  });

  it('追加の機密フィールドを検出する（大文字小文字無視）', () => {
    const data = {
      APIKey: 'secret',
      AUTH_TOKEN: 'token123',
      password: 'pass',
      MASTER_PASSWORD_HASH: 'hash',
      safe_field: 'ok'
    };
    const result = redactSensitiveData(data) as Record<string, unknown>;
    expect(result.APIKey).toBe('[REDACTED]');
    expect(result.AUTH_TOKEN).toBe('[REDACTED]');
    expect(result.password).toBe('[REDACTED]');
    expect(result.MASTER_PASSWORD_HASH).toBe('[REDACTED]');
    expect(result.safe_field).toBe('ok');
  });

  it('プリミティブ値はそのまま返す', () => {
    expect(redactSensitiveData('string')).toBe('string');
    expect(redactSensitiveData(42)).toBe(42);
    expect(redactSensitiveData(true)).toBe(true);
    expect(redactSensitiveData(null)).toBe(null);
    expect(redactSensitiveData(undefined)).toBe(undefined);
  });

  it('配列内の各要素を再帰的に処理する', () => {
    const data = [{ openai_api_key: 'secret' }, { name: 'test' }];
    const result = redactSensitiveData(data) as Record<string, unknown>[];
    expect(result[0].openai_api_key).toBe('[REDACTED]');
    expect(result[1].name).toBe('test');
  });

  it('ネストされたオブジェクトを再帰的に処理する', () => {
    const data = {
      outer: {
        inner: {
          obsidian_api_key: 'nested_secret'
        }
      }
    };
    const result = redactSensitiveData(data) as Record<string, unknown>;
    const outer = result.outer as Record<string, unknown>;
    const inner = outer.inner as Record<string, unknown>;
    expect(inner.obsidian_api_key).toBe('[REDACTED]');
  });

  it('最大再帰深度を超えた場合に [REDACTED: too deep] を返す', () => {
    let deep: any = { value: 'leaf' };
    for (let i = 0; i < 101; i++) {
      deep = { child: deep };
    }
    const result = redactSensitiveData(deep);
    expect(result).toBeDefined();
  });

  it('hmac_secret フィールドを検出する', () => {
    const data = { hmac_secret: 'my_secret', normal: 'value' };
    const result = redactSensitiveData(data) as Record<string, unknown>;
    expect(result.hmac_secret).toBe('[REDACTED]');
    expect(result.normal).toBe('value');
  });
});

describe('consoleSecureError', () => {
  const originalConsoleError = console.error;

  afterEach(() => {
    console.error = originalConsoleError;
  });

  it('データをレダクトしてからコンソールエラーを出力する', () => {
    const errors: unknown[] = [];
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    consoleSecureError('Test error', { obsidian_api_key: 'secret', name: 'test' });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual(['Test error', { obsidian_api_key: '[REDACTED]', name: 'test' }]);
  });

  it('データがundefinedの場合はメッセージのみ出力する', () => {
    const errors: unknown[] = [];
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    consoleSecureError('Error without data', undefined);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual(['Error without data']);
  });

  it('データがnullの場合はメッセージのみ出力する', () => {
    const errors: unknown[] = [];
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    consoleSecureError('Error with null', null);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual(['Error with null']);
  });
});
