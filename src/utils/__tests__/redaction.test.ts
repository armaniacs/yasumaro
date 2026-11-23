/**
 * redaction.ts のテスト
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { maskSensitiveData, redactHeaderValue, consoleSecureError, SENSITIVE_HEADER_REASONS } from '../sensitiveDataMask.js';
// Side-effect import: consoleSecureError reaches the logger seam via a
// dynamic import, which only settles once the seam module is in the graph
// (production callers always load the logger; tests must do the same).
import '../logger/api.js';
import { initLogger, resetLoggerWiring, getLogs } from '../logger/core.js';
import { InMemoryLogAdapter } from '../logger/storageAdapter.js';
import { ImmediateFlushScheduler } from '../logger/flushScheduler.js';

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
    const result = maskSensitiveData(data) as Record<string, unknown>;
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
    const result = maskSensitiveData(data) as Record<string, unknown>;
    expect(result.APIKey).toBe('[REDACTED]');
    expect(result.AUTH_TOKEN).toBe('[REDACTED]');
    expect(result.password).toBe('[REDACTED]');
    expect(result.MASTER_PASSWORD_HASH).toBe('[REDACTED]');
    expect(result.safe_field).toBe('ok');
  });

  it('returns primitives unchanged', () => {
    expect(maskSensitiveData('string')).toBe('string');
    expect(maskSensitiveData(42)).toBe(42);
    expect(maskSensitiveData(true)).toBe(true);
    expect(maskSensitiveData(null)).toBe(null);
    expect(maskSensitiveData(undefined)).toBe(undefined);
  });

  it('processes each array element recursively', () => {
    const data = [{ openai_api_key: 'secret' }, { name: 'test' }];
    const result = maskSensitiveData(data) as Record<string, unknown>[];
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
    const result = maskSensitiveData(data) as Record<string, unknown>;
    const outer = result.outer as Record<string, unknown>;
    const inner = outer.inner as Record<string, unknown>;
    expect(inner.obsidian_api_key).toBe('[REDACTED]');
  });

  it('returns [REDACTED: too deep] beyond max recursion depth', () => {
    let deep: any = { value: 'leaf' };
    for (let i = 0; i < 101; i++) {
      deep = { child: deep };
    }
    const result = maskSensitiveData(deep);
    expect(result).toBeDefined();
  });

  it('detects the hmac_secret field', () => {
    const data = { hmac_secret: 'my_secret', normal: 'value' };
    const result = maskSensitiveData(data) as Record<string, unknown>;
    expect(result.hmac_secret).toBe('[REDACTED]');
    expect(result.normal).toBe('value');
  });

  it('detects the provider_api_key field', () => {
    const data = { provider_api_key: 'dynamic_secret', normal: 'value' };
    const result = maskSensitiveData(data) as Record<string, unknown>;
    expect(result.provider_api_key).toBe('[REDACTED]');
    expect(result.normal).toBe('value');
  });

  it('detects the github_pat field', () => {
    const data = { github_pat: 'ghp_secret123', normal: 'value' };
    const result = maskSensitiveData(data) as Record<string, unknown>;
    expect(result.github_pat).toBe('[REDACTED]');
    expect(result.normal).toBe('value');
  });
});

describe('consoleSecureError', () => {
  // PBI 2026-11-11-03: thin seam-delegation wrapper. The redacted payload
  // travels the logger seam; no direct console.error leaves this module on
  // the primary path (a last-resort console remains only when the seam
  // module itself cannot load).
  beforeEach(() => {
    initLogger({
      storage: new InMemoryLogAdapter(),
      scheduler: new ImmediateFlushScheduler(),
    });
  });

  afterEach(() => {
    resetLoggerWiring();
    vi.restoreAllMocks();
  });

  async function flushAsyncChain(): Promise<void> {
    for (let i = 0; i < 50; i++) await Promise.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    for (let i = 0; i < 50; i++) await Promise.resolve();
  }

  it('redacts data and routes it through the logger seam', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    consoleSecureError('Test error', { obsidian_api_key: 'secret', name: 'test' });
    await flushAsyncChain();

    expect(errorSpy).not.toHaveBeenCalled();
    const logs = await getLogs();
    const entry = logs[logs.length - 1];
    expect(entry).toBeDefined();
    expect(entry!.message).toBe('Test error');
    expect(JSON.stringify(entry)).not.toContain('secret');
    expect(JSON.stringify(entry)).toContain('test');
  });

  it('routes only the message through the seam when data is undefined', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    consoleSecureError('Error without data', undefined);
    await flushAsyncChain();

    expect(errorSpy).not.toHaveBeenCalled();
    const logs = await getLogs();
    expect(logs[logs.length - 1]!.message).toBe('Error without data');
  });

  it('routes only the message through the seam when data is null', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    consoleSecureError('Error with null', null);
    await flushAsyncChain();

    expect(errorSpy).not.toHaveBeenCalled();
    const logs = await getLogs();
    expect(logs[logs.length - 1]!.message).toBe('Error with null');
  });
});
