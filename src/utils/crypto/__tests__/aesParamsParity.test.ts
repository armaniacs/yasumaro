/**
 * aesParamsParity.test.ts
 * Pins the AES parameter SSOT (PBI 04): primitives.ts (deriveKey / generateIV)
 * and hmacKeyStore.ts (KEK import / wrap) used to restate KEY_LENGTH=256 and
 * IV_LENGTH=12 per file; both now derive them from cryptoParams.CRYPTO_PARAMS,
 * so a one-sided edit cannot change the key size or the nonce length in one
 * crypto context only.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { Crypto } from '@peculiar/webcrypto';
import { CRYPTO_PARAMS } from '../cryptoParams.js';
import { deriveKey, generateIV, generateSalt } from '../primitives.js';
import { deriveHmacWrappingKey } from '../hmacKeyStore.js';

beforeEach(() => {
  const webcrypto = new Crypto();
  global.crypto = webcrypto;
  globalThis.crypto = webcrypto;
});

describe('AES parameter SSOT (PBI 04)', () => {
  test('CRYPTO_PARAMS pins the AES key length and the GCM IV length', () => {
    expect(CRYPTO_PARAMS.AES_KEY_LENGTH_BITS).toBe(256);
    expect(CRYPTO_PARAMS.AES_GCM_IV_LENGTH_BYTES).toBe(12);
  });

  test('generateIV produces the SSOT IV length', () => {
    expect(generateIV().length).toBe(CRYPTO_PARAMS.AES_GCM_IV_LENGTH_BYTES);
  });

  test('deriveKey produces an AES key of the SSOT key length', async () => {
    const salt = generateSalt();
    const key = await deriveKey('Abcdef123!@#Strong', salt);
    const algorithm = key.algorithm as unknown as { length: number };
    expect(algorithm.length).toBe(CRYPTO_PARAMS.AES_KEY_LENGTH_BITS);
  });

  test('deriveHmacWrappingKey produces a KEK of the same SSOT key length', async () => {
    const salt = generateSalt();
    const key = await deriveHmacWrappingKey('Abcdef123!@#Strong', salt);
    const algorithm = key.algorithm as unknown as { length: number };
    expect(algorithm.length).toBe(CRYPTO_PARAMS.AES_KEY_LENGTH_BITS);
  });
});
