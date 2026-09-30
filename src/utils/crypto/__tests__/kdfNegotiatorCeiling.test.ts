import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Crypto } from '@peculiar/webcrypto';

const deriveKeySpy = vi.hoisted(() => vi.fn());

vi.mock('../index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../index.js')>();
  deriveKeySpy.mockImplementation(actual.deriveKey);
  return { ...actual, deriveKey: deriveKeySpy };
});

import { decryptWithIterationCandidates, MAX_KDF_ITERATIONS } from '../kdfNegotiator.js';
import { CRYPTO_PARAMS } from '../cryptoParams.js';
import { encrypt, deriveKey, generateSalt, bytesToBase64 } from '../index.js';

const PASSWORD = 'test-password-1234567890ABC!';

async function encryptAt(iterations: number) {
  const salt = generateSalt();
  const key = await deriveKey(PASSWORD, salt, iterations);
  const enc = await encrypt('payload', key);
  return { saltB64: bytesToBase64(salt), ...enc };
}

beforeEach(() => {
  const webcrypto = new Crypto();
  global.crypto = webcrypto;
  globalThis.crypto = webcrypto;
  deriveKeySpy.mockClear();
});

describe('kdfNegotiator', () => {
  describe('decryptWithIterationCandidates ceiling', () => {
    it('never derives a key with a stored iteration count above the ceiling', async () => {
      const { saltB64, ciphertext, iv } = await encryptAt(CRYPTO_PARAMS.LEGACY_PBKDF2_ITERATIONS);
      deriveKeySpy.mockClear();

      const result = await decryptWithIterationCandidates(
        PASSWORD, saltB64, ciphertext, iv, 2147483647
      );

      const used = deriveKeySpy.mock.calls.map((c) => c[2]);
      expect(used).not.toContain(2147483647);
      expect(used.every((n) => n <= MAX_KDF_ITERATIONS)).toBe(true);
      expect(result.usedIterations).toBe(CRYPTO_PARAMS.LEGACY_PBKDF2_ITERATIONS);
    });

    it('rejects non-integer stored iteration counts', async () => {
      const { saltB64, ciphertext, iv } = await encryptAt(CRYPTO_PARAMS.PBKDF2_ITERATIONS);
      deriveKeySpy.mockClear();

      await decryptWithIterationCandidates(PASSWORD, saltB64, ciphertext, iv, 1000.5);

      expect(deriveKeySpy.mock.calls.map((c) => c[2])).not.toContain(1000.5);
    });

    it('still honours a stored count at the ceiling boundary as a candidate', async () => {
      const { saltB64, ciphertext, iv } = await encryptAt(CRYPTO_PARAMS.PBKDF2_ITERATIONS);
      deriveKeySpy.mockClear();

      await decryptWithIterationCandidates(
        PASSWORD, saltB64, ciphertext, iv, CRYPTO_PARAMS.LEGACY_PBKDF2_ITERATIONS + 1
      );

      expect(deriveKeySpy.mock.calls[0][2]).toBe(CRYPTO_PARAMS.LEGACY_PBKDF2_ITERATIONS + 1);
    });

    it('keeps the ceiling above the current SSOT iteration count', () => {
      expect(MAX_KDF_ITERATIONS).toBeGreaterThanOrEqual(CRYPTO_PARAMS.PBKDF2_ITERATIONS);
    });
  });
});
