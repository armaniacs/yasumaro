/**
 * Tampered MASTER_PASSWORD_KDF_ITERATIONS must fail closed in both the unlock
 * and the key-derivation path, without touching stored hash / salt.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../rateLimiter.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ success: true }),
  recordFailedAttempt: vi.fn().mockResolvedValue(undefined),
  resetFailedAttempts: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../authGuard.js', () => ({
  isLocked: vi.fn().mockResolvedValue(false),
}));

import {
  unlockWithPassword,
  getOrCreateEncryptionKey,
  clearEncryptionKeyCache,
} from '../encryptionSession.js';
import { StorageKeys } from '../types.js';
import {
  hashPasswordWithPBKDF2,
  generateSalt,
  bytesToBase64,
  MIN_KDF_ITERATIONS,
  MAX_KDF_ITERATIONS,
} from '../../crypto/primitives.js';
import { CRYPTO_PARAMS } from '../../crypto/cryptoParams.js';

const PASSWORD = 'correct horse battery staple 1!';
const salt = generateSalt();
let hashAtFloor = '';

async function seed(iterations: unknown, hash = hashAtFloor): Promise<void> {
  await chrome.storage.local.set({
    [StorageKeys.MASTER_PASSWORD_ENABLED]: true,
    [StorageKeys.MASTER_PASSWORD_HASH]: hash,
    [StorageKeys.MASTER_PASSWORD_SALT]: bytesToBase64(salt),
    [StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS]: iterations,
  });
}

async function metaSnapshot(): Promise<Record<string, unknown>> {
  return chrome.storage.local.get([
    StorageKeys.MASTER_PASSWORD_HASH,
    StorageKeys.MASTER_PASSWORD_SALT,
    StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS,
  ]);
}

beforeEach(async () => {
  clearEncryptionKeyCache();
  vi.clearAllMocks();
  hashAtFloor = await hashPasswordWithPBKDF2(PASSWORD, salt, MIN_KDF_ITERATIONS);
});

describe('encryptionSession KDF iteration bounds', () => {
  describe('unlockWithPassword', () => {
    it('unlocks with legacy-floor iterations', async () => {
      await seed(MIN_KDF_ITERATIONS);
      await expect(unlockWithPassword(PASSWORD)).resolves.toBe(true);
    });

    it.each([
      ['tampered to 1', 1],
      ['below floor', MIN_KDF_ITERATIONS - 1],
      ['int32 max', 2147483647],
      ['above ceiling', MAX_KDF_ITERATIONS + 1],
      ['NaN', NaN],
      ['negative', -1],
      ['non-integer', CRYPTO_PARAMS.PBKDF2_ITERATIONS + 0.5],
      ['string', String(MIN_KDF_ITERATIONS)],
    ])('fails closed and leaves metadata untouched when iterations are %s', async (_l, bad) => {
      // Hash computed with the attacker-chosen count so a naive verify would accept it.
      const weak = typeof bad === 'number' && Number.isInteger(bad) && bad > 0 && bad < 1_000
        ? await hashPasswordWithPBKDF2(PASSWORD, salt, bad)
        : hashAtFloor;
      await seed(bad, weak);
      const before = await metaSnapshot();

      await expect(unlockWithPassword(PASSWORD)).rejects.toThrow('Master password data corrupted');

      expect(await metaSnapshot()).toEqual(before);
    });
  });

  describe('deriveKeyFromPassword via getOrCreateEncryptionKey', () => {
    it.each([
      ['below floor', 1],
      ['int32 max', 2147483647],
      ['above ceiling', MAX_KDF_ITERATIONS + 1],
    ])('rejects stored iterations that are %s before deriving', async (_l, bad) => {
      await seed(MIN_KDF_ITERATIONS);
      await unlockWithPassword(PASSWORD);
      await chrome.storage.local.set({ [StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS]: bad });
      const derive = vi.spyOn(globalThis.crypto.subtle, 'deriveKey');

      await expect(getOrCreateEncryptionKey()).rejects.toThrow('Master password data corrupted');

      expect(derive).not.toHaveBeenCalled();
    });
  });
});
