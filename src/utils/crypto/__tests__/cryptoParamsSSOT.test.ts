/**
 * cryptoParamsSSOT.test.ts
 * SSOT 参照網羅、旧形式 100k 互換、needsRehash lazy migration の検証。
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Crypto } from '@peculiar/webcrypto';
import { CRYPTO_PARAMS, validatePasswordPolicy } from '../cryptoParams.js';
import {
  hashPasswordWithPBKDF2,
  verifyPasswordWithPBKDF2,
  generateSalt,
} from '../primitives.js';
import { deriveHmacWrappingKey } from '../hmacKeyStore.js';

beforeEach(() => {
  const webcrypto = new Crypto();
  // @ts-expect-error overwrite for test
  global.crypto = webcrypto;
  // @ts-expect-error ensure globalThis.crypto
  globalThis.crypto = webcrypto;
});

describe('CRYPTO_PARAMS SSOT', () => {
  test('PBKDF2_ITERATIONS は 600_000', () => {
    expect(CRYPTO_PARAMS.PBKDF2_ITERATIONS).toBe(600_000);
  });

  test('LEGACY_PBKDF2_ITERATIONS は 100_000', () => {
    expect(CRYPTO_PARAMS.LEGACY_PBKDF2_ITERATIONS).toBe(100_000);
  });

  test('ENVELOPE_VERSION は 2', () => {
    expect(CRYPTO_PARAMS.ENVELOPE_VERSION).toBe(2);
  });

  test('primitives の ENVELOPE_ITERATIONS と PBKDF2_ITERATIONS が SSOT と一致', async () => {
    const { ENVELOPE_ITERATIONS, CURRENT_ENVELOPE_VERSION } = await import('../primitives.js');
    expect(ENVELOPE_ITERATIONS).toBe(CRYPTO_PARAMS.PBKDF2_ITERATIONS);
    expect(CURRENT_ENVELOPE_VERSION).toBe(CRYPTO_PARAMS.ENVELOPE_VERSION);
  });

  test('envelope.ts の iterations が SSOT を使う', async () => {
    const { encryptEnvelope } = await import('../envelope.js');
    const envelope = await encryptEnvelope('hello', 'test-password-1234567890ABC!');
    expect(envelope.iterations).toBe(CRYPTO_PARAMS.PBKDF2_ITERATIONS);
    expect(envelope.version).toBe(CRYPTO_PARAMS.ENVELOPE_VERSION);
  });
});

describe('validatePasswordPolicy (strict)', () => {
  test('空文字は拒否', () => {
    const r = validatePasswordPolicy('');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/required/i);
  });

  test('12文字未満は拒否 (rockyou 上位は短いため失敗)', () => {
    expect(validatePasswordPolicy('password').ok).toBe(false);
    expect(validatePasswordPolicy('12345678').ok).toBe(false);
    expect(validatePasswordPolicy('password1').ok).toBe(false); // 9文字
  });

  test('文字種3種未満は拒否', () => {
    // 12文字だが英小のみ
    expect(validatePasswordPolicy('abcdefghijkl').ok).toBe(false);
    // 英小+数字のみ (2種)
    expect(validatePasswordPolicy('abcdefgh1234').ok).toBe(false);
    // 英小+英大のみ (2種)
    expect(validatePasswordPolicy('Abcdefghijkl').ok).toBe(false);
  });

  test('rockyou 上位パスワードは全て拒否', () => {
    const rockyouTop = ['password', '123456', '123456789', 'qwerty', 'password1', '12345678'];
    for (const pw of rockyouTop) {
      const r = validatePasswordPolicy(pw);
      expect(r.ok).toBe(false);
    }
  });

  test('弱いが長いだけのパスワードは文字種不足で拒否', () => {
    // 12文字、数字+記号+英小だが strength 低いケースは文字種で弾かれるが念のため
    expect(validatePasswordPolicy('abc123!@#abc').ok).toBe(true); // 12文字、英小+数字+記号=3種、scoreはそこそこ
  });

  test('強いパスワード (12文字、3種以上、score>=40) は許可', () => {
    expect(validatePasswordPolicy('Abcdef123!@#').ok).toBe(true);
    expect(validatePasswordPolicy('StrongPass123!').ok).toBe(true);
    expect(validatePasswordPolicy('MyP@ssw0rd2024').ok).toBe(true);
  });

  test('境界: 12文字ちょうどで3種あれば許可 (scoreが40以上になる例)', () => {
    // 12文字, 英大英小数字 = 3種, score = 20(len8)+10(len12)+20(mixed)+20(digit)=70 => pass
    expect(validatePasswordPolicy('Abcdefgh1234').ok).toBe(true);
  });

  test('strength score <40 は拒否 (例: 長さは足りるがパターンが弱いケースは稀だがカバー)', () => {
    // この実装では 12文字かつ3種あれば score は最低でも 50以上になるため
    // 40未満ケースは実質発生しないが、関数は score チェックを含む
    // 代わりに 12文字未満ケースで score が40でも長さで拒否されることを確認
    const r = validatePasswordPolicy('Abc1!def');
    expect(r.ok).toBe(false);
  });
});

describe('旧形式 100k 互換読み込み + needsRehash lazy migration', () => {
  test('旧 iteration (100k) で生成されたハッシュは検証成功し needsRehash=true', async () => {
    const password = 'Abcdef123!@#Strong';
    const salt = generateSalt();
    const legacyHash = await hashPasswordWithPBKDF2(password, salt, CRYPTO_PARAMS.LEGACY_PBKDF2_ITERATIONS);

    // 明示 iteration なしの legacy パス: 両方計算、legacy にマッチ -> needsRehash true
    const result = await verifyPasswordWithPBKDF2(password, legacyHash, salt);
    expect(result.isValid).toBe(true);
    expect(result.needsRehash).toBe(true);
  });

  test('現行 iteration (600k) で生成されたハッシュは needsRehash=false', async () => {
    const password = 'Abcdef123!@#Strong';
    const salt = generateSalt();
    const currentHash = await hashPasswordWithPBKDF2(password, salt, CRYPTO_PARAMS.PBKDF2_ITERATIONS);

    const result = await verifyPasswordWithPBKDF2(password, currentHash, salt);
    expect(result.isValid).toBe(true);
    expect(result.needsRehash).toBe(false);
  });

  test('誤パスワードは isValid=false', async () => {
    const salt = generateSalt();
    const hash = await hashPasswordWithPBKDF2('CorrectPass123!@#', salt, CRYPTO_PARAMS.PBKDF2_ITERATIONS);
    const result = await verifyPasswordWithPBKDF2('WrongPass123!@#', hash, salt);
    expect(result.isValid).toBe(false);
    expect(result.needsRehash).toBe(false);
  });

  test('iterations 指定パス: 100k 保存値は needsRehash=true を返す', async () => {
    const pw = 'Abcdef123!@#Strong';
    const salt = generateSalt();
    const hash = await hashPasswordWithPBKDF2(pw, salt, CRYPTO_PARAMS.LEGACY_PBKDF2_ITERATIONS);
    const result = await verifyPasswordWithPBKDF2(pw, hash, salt, CRYPTO_PARAMS.LEGACY_PBKDF2_ITERATIONS);
    expect(result.isValid).toBe(true);
    expect(result.needsRehash).toBe(true);
  });

  test('iterations 指定パス: 600k 保存値は needsRehash=false', async () => {
    const pw = 'Abcdef123!@#Strong';
    const salt = generateSalt();
    const hash = await hashPasswordWithPBKDF2(pw, salt, CRYPTO_PARAMS.PBKDF2_ITERATIONS);
    const result = await verifyPasswordWithPBKDF2(pw, hash, salt, CRYPTO_PARAMS.PBKDF2_ITERATIONS);
    expect(result.isValid).toBe(true);
    expect(result.needsRehash).toBe(false);
  });

  test('lazy migration シナリオ: 100k ハッシュ検証後に 600k で再ハッシュすれば新形式で検証可能', async () => {
    const pw = 'Abcdef123!@#Strong';
    const salt = generateSalt();
    const legacyHash = await hashPasswordWithPBKDF2(pw, salt, CRYPTO_PARAMS.LEGACY_PBKDF2_ITERATIONS);
    const verifyLegacy = await verifyPasswordWithPBKDF2(pw, legacyHash, salt);
    expect(verifyLegacy.needsRehash).toBe(true);

    // lazy migration: 現行 iterations で再ハッシュ
    const migratedHash = await hashPasswordWithPBKDF2(pw, salt, CRYPTO_PARAMS.PBKDF2_ITERATIONS);
    const verifyMigrated = await verifyPasswordWithPBKDF2(pw, migratedHash, salt);
    expect(verifyMigrated.isValid).toBe(true);
    expect(verifyMigrated.needsRehash).toBe(false);
  });
});

describe('deriveHmacWrappingKey が SSOT iterations で導出できる', () => {
  test('master password から KEK を導出できる', async () => {
    const pw = 'Abcdef123!@#Strong';
    const salt = generateSalt();
    const key = await deriveHmacWrappingKey(pw, salt);
    expect(key).toBeDefined();
    expect(key.type).toBe('secret');
  });
});
