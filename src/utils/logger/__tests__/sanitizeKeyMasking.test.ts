/**
 * sanitizeKeyMasking.test.ts
 *
 * ログ詳細のサニタイザが「キー名」だけで秘匿値を落とすことを固定する。
 * 秘匿判定は値の型（文字列・数値・null・undefined・オブジェクト）に
 * 依存しないこと、既存の PII マスキング・null-prototype 防御・深度制限を
 * 壊さないことを検証する。
 */

import { describe, expect, it } from 'vitest';
import { sanitizeArray, sanitizeLogDetails } from '../sanitize.js';
import { maskSecretValueByKey } from '../../sensitiveDataMask.js';

const SECRET_MASK = '***';

/** Level 1 相当のキー名（storage の API キー項目 + 秘匿の追加項目）。 */
const LEVEL1_KEYS = [
  'obsidian_api_key',
  'gemini_api_key',
  'openai_api_key',
  'openai_2_api_key',
  'provider_api_key',
  'github_pat',
  'apiKey',
  'fullKey',
  'authToken',
  'auth',
  'password',
  'token',
  'master_password_hash',
  'hmac_secret',
  'api_key',
  'API_KEY',
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'passwd',
  'private_key',
  'privateKey',
  'client_secret',
  'clientSecret',
] as const;

interface ValueCase {
  label: string;
  make: () => unknown;
}

const VALUE_CASES: ValueCase[] = [
  { label: 'string', make: () => 'sk-live-value-that-must-not-survive' },
  { label: 'number', make: () => 1234567890 },
  { label: 'null', make: () => null },
  { label: 'undefined', make: () => undefined },
  { label: 'nested object', make: () => ({ inner: 'nested-secret-value' }) },
];

const MASKING_MATRIX = LEVEL1_KEYS.flatMap(key =>
  VALUE_CASES.map(valueCase => ({ key, ...valueCase })),
);

describe('sanitizeLogDetails — キー名による秘匿マスキング', () => {
  it.each(MASKING_MATRIX)('masks "$key" ($label) regardless of value type', async ({ key, make }) => {
    const out = await sanitizeLogDetails({ [key]: make() });

    expect(out[key]).toBe(SECRET_MASK);
  });

  it('keeps the PII stage working alongside key-name masking', async () => {
    const out = await sanitizeLogDetails({
      email: 'user@example.com',
      github_pat: 'ghp_value-that-must-not-survive',
    });

    expect(out.github_pat).toBe(SECRET_MASK);
    expect(out.email).not.toContain('user@example.com');
    expect(out.email_maskedTypes).toEqual(['email']);
  });

  it('masks on key name before the PII stage, so PII annotations are not emitted', async () => {
    const out = await sanitizeLogDetails({ authToken: 'user@example.com' });

    expect(out.authToken).toBe(SECRET_MASK);
    expect(out.authToken_maskedTypes).toBeUndefined();
  });

  it('masks secret keys found in nested details', async () => {
    const out = await sanitizeLogDetails({
      settings: { openai_api_key: 'sk-value-that-must-not-survive', threshold: 5 },
    });
    const nested = out.settings as Record<string, unknown>;

    expect(nested.openai_api_key).toBe(SECRET_MASK);
    expect(nested.threshold).toBe(5);
  });

  it('masks secret keys on objects inside arrays', async () => {
    const arr = (await sanitizeArray([
      { apiKey: 'sk-value-that-must-not-survive' },
      'plain value',
    ])) as unknown[];

    expect((arr[0] as Record<string, unknown>).apiKey).toBe(SECRET_MASK);
    expect(arr[1]).toBe('plain value');
  });

  it('leaves non-secret keys untouched, including the PII pass', async () => {
    const out = await sanitizeLogDetails({ user: 'bob', count: 3, retry: true });

    expect(out.user).toBe('bob');
    expect(out.count).toBe(3);
    expect(out.retry).toBe(true);
  });

  it('keeps the null-prototype accumulator when a secret key sits next to __proto__', async () => {
    const details = JSON.parse('{"__proto__": {"polluted": "pwned"}, "apiKey": "sk-value"}') as Record<string, unknown>;
    const out = await sanitizeLogDetails(details) as Record<string, unknown>;

    expect(Object.getPrototypeOf(out)).toBeNull();
    expect((out as unknown as { polluted?: unknown }).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(true);
    expect(out.apiKey).toBe(SECRET_MASK);
  });
});

describe('maskSecretValueByKey', () => {
  it('returns the very same value when the key is not a secret key', () => {
    const nested = { inner: 'value' };

    expect(maskSecretValueByKey('user', 'bob')).toBe('bob');
    expect(maskSecretValueByKey('count', 3)).toBe(3);
    expect(maskSecretValueByKey('nothing', null)).toBeNull();
    expect(maskSecretValueByKey('payload', nested)).toBe(nested);
  });

  it('masks secret keys regardless of the value type', () => {
    expect(maskSecretValueByKey('openai_api_key', 'sk-value')).toBe(SECRET_MASK);
    expect(maskSecretValueByKey('token', 1234)).toBe(SECRET_MASK);
    expect(maskSecretValueByKey('clientSecret', null)).toBe(SECRET_MASK);
    expect(maskSecretValueByKey('master_password_hash', undefined)).toBe(SECRET_MASK);
  });

  it('matches the key name case-insensitively and by substring, as the shared matcher does', () => {
    expect(maskSecretValueByKey('GITHUB_PAT', 'ghp-value')).toBe(SECRET_MASK);
    expect(maskSecretValueByKey('githubPersonalAccessToken', 'ghp-value')).toBe(SECRET_MASK);
  });
});
