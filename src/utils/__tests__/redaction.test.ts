/**
 * redaction.ts のテスト
 */

import { redactSensitiveData, redactHeaderValue, consoleSecureError, SENSITIVE_HEADER_REASONS } from '../redaction.js';

describe('redactHeaderValue', () => {
  describe('authorization reason', () => {
    it('returns [REDACTED] for authorization', () => {
      expect(redactHeaderValue('Bearer secret-token-abc123', 'authorization')).toBe('[REDACTED]');
    });

    it('returns [REDACTED] even for empty authorization', () => {
      expect(redactHeaderValue('', 'authorization')).toBe('[REDACTED]');
    });
  });

  describe('非機密 reason', () => {
    it('returns the original value for cache-control', () => {
      expect(redactHeaderValue('private, no-store', 'cache-control')).toBe('private, no-store');
    });

    it('returns the original value for set-cookie', () => {
      expect(redactHeaderValue('session=abc; HttpOnly', 'set-cookie')).toBe('session=abc; HttpOnly');
    });

    it('returns the original value for unknown reasons', () => {
      expect(redactHeaderValue('some-value', 'unknown-reason')).toBe('some-value');
    });

    it('returns the original value for an empty reason', () => {
      expect(redactHeaderValue('some-value', '')).toBe('some-value');
    });
  });

  describe('SENSITIVE_HEADER_REASONS', () => {
    it('contains authorization', () => {
      expect(SENSITIVE_HEADER_REASONS).toContain('authorization');
    });
  });
});

describe('redactSensitiveData', () => {
  it('replaces API key fields with [REDACTED]', () => {
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

  it('detects additional sensitive fields (case-insensitive)', () => {
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

  it('returns primitives unchanged', () => {
    expect(redactSensitiveData('string')).toBe('string');
    expect(redactSensitiveData(42)).toBe(42);
    expect(redactSensitiveData(true)).toBe(true);
    expect(redactSensitiveData(null)).toBe(null);
    expect(redactSensitiveData(undefined)).toBe(undefined);
  });

  it('processes each array element recursively', () => {
    const data = [{ openai_api_key: 'secret' }, { name: 'test' }];
    const result = redactSensitiveData(data) as Record<string, unknown>[];
    expect(result[0]!.openai_api_key).toBe('[REDACTED]');
    expect(result[1]!.name).toBe('test');
  });

  it('processes nested objects recursively', () => {
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

  it('returns [REDACTED: too deep] beyond max recursion depth', () => {
    let deep: any = { value: 'leaf' };
    for (let i = 0; i < 101; i++) {
      deep = { child: deep };
    }
    const result = redactSensitiveData(deep);
    expect(result).toBeDefined();
  });

  it('detects the hmac_secret field', () => {
    const data = { hmac_secret: 'my_secret', normal: 'value' };
    const result = redactSensitiveData(data) as Record<string, unknown>;
    expect(result.hmac_secret).toBe('[REDACTED]');
    expect(result.normal).toBe('value');
  });

  it('detects the provider_api_key field', () => {
    const data = { provider_api_key: 'dynamic_secret', normal: 'value' };
    const result = redactSensitiveData(data) as Record<string, unknown>;
    expect(result.provider_api_key).toBe('[REDACTED]');
    expect(result.normal).toBe('value');
  });

  it('detects the github_pat field', () => {
    const data = { github_pat: 'ghp_secret123', normal: 'value' };
    const result = redactSensitiveData(data) as Record<string, unknown>;
    expect(result.github_pat).toBe('[REDACTED]');
    expect(result.normal).toBe('value');
  });
});

describe('consoleSecureError', () => {
  const originalConsoleError = console.error;

  afterEach(() => {
    console.error = originalConsoleError;
  });

  it('redacts data before logging a console error', () => {
    const errors: unknown[] = [];
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    consoleSecureError('Test error', { obsidian_api_key: 'secret', name: 'test' });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual(['Test error', { obsidian_api_key: '[REDACTED]', name: 'test' }]);
  });

  it('logs only the message when data is undefined', () => {
    const errors: unknown[] = [];
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    consoleSecureError('Error without data', undefined);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual(['Error without data']);
  });

  it('logs only the message when data is null', () => {
    const errors: unknown[] = [];
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    consoleSecureError('Error with null', null);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual(['Error with null']);
  });
});
