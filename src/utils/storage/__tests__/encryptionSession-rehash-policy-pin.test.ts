/**
 * Pins the one canonical rehash policy across every master-password path:
 * set / change / remove (self-verify) / auth-modal self-verify. When a
 * password is accepted against a legacy hash, the stored hash is regenerated
 * at ENVELOPE_ITERATIONS and the KDF iteration count is updated in the same
 * atomic write — never a raw single-field write.
 *
 * Fixture-first regression (PBI 2026-10-07-11): the auth-modal path used to
 * rehash through a raw `chrome.storage.local.set({ master_password_hash })`
 * write, leaving the stored iteration count stale. The stored-iterations
 * constant-time verify trusts that count, so the next unlock rejected the
 * correct password. The atomic pair write makes that state unreachable from
 * the rehash paths.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// PBKDF2 at the production 600,000 iterations dominates this file's runtime.
// The production values are asserted in cryptoParamsSSOT.test.ts; here the
// KDF only needs to behave, not to be expensive.
vi.mock('../../crypto/cryptoParams.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../crypto/cryptoParams.js')>();
  return {
    ...actual,
    CRYPTO_PARAMS: {
      ...actual.CRYPTO_PARAMS,
      PBKDF2_ITERATIONS: 1_000,
      LEGACY_PBKDF2_ITERATIONS: 100,
    },
  };
});

vi.mock('../../rateLimiter.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ success: true }),
  recordFailedAttempt: vi.fn().mockResolvedValue(undefined),
  resetFailedAttempts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../authGuard.js', () => ({
  isLocked: vi.fn().mockResolvedValue(false),
}));

import {
  setMasterPassword,
  changeMasterPassword,
  removeMasterPassword,
  unlockWithPassword,
  verifyMasterPasswordWithRehash,
  clearEncryptionKeyCache,
} from '../encryptionSession.js';
import { StorageKeys } from '../types.js';
import {
  hashPasswordWithPBKDF2,
  verifyPasswordWithPBKDF2,
  generateSalt,
  bytesToBase64,
  base64ToBytes,
  ENVELOPE_ITERATIONS,
} from '../../crypto/primitives.js';
import { CRYPTO_PARAMS } from '../../crypto/cryptoParams.js';

const PASSWORD = 'correct horse battery staple 1!';
const NEW_PASSWORD = 'correct horse battery staple 2?';
const LEGACY_ITERATIONS = CRYPTO_PARAMS.LEGACY_PBKDF2_ITERATIONS;
const salt = generateSalt();

/** A pre-ENVELOPE setup: hash and stored count both at the legacy value. */
async function seedLegacy(): Promise<void> {
  const legacyHash = await hashPasswordWithPBKDF2(PASSWORD, salt, LEGACY_ITERATIONS);
  await chrome.storage.local.set({
    [StorageKeys.MASTER_PASSWORD_ENABLED]: true,
    [StorageKeys.MASTER_PASSWORD_SALT]: bytesToBase64(salt),
    [StorageKeys.MASTER_PASSWORD_HASH]: legacyHash,
    [StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS]: LEGACY_ITERATIONS,
  });
}

/** The stale state the old raw single-field rehash produced: envelope hash
 * next to a legacy stored count. The constant-time verify trusts the stored
 * count and rejects the correct password. */
async function seedStaleRehash(): Promise<void> {
  const envelopeHash = await hashPasswordWithPBKDF2(PASSWORD, salt, ENVELOPE_ITERATIONS);
  await chrome.storage.local.set({
    [StorageKeys.MASTER_PASSWORD_ENABLED]: true,
    [StorageKeys.MASTER_PASSWORD_SALT]: bytesToBase64(salt),
    [StorageKeys.MASTER_PASSWORD_HASH]: envelopeHash,
    [StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS]: LEGACY_ITERATIONS,
  });
}

async function metaSnapshot(): Promise<Record<string, unknown>> {
  return chrome.storage.local.get([
    StorageKeys.MASTER_PASSWORD_ENABLED,
    StorageKeys.MASTER_PASSWORD_HASH,
    StorageKeys.MASTER_PASSWORD_SALT,
    StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS,
  ]);
}

/** The stored metadata must be the consistent envelope pair: the count is
 * ENVELOPE_ITERATIONS and the stored hash verifies at that same count. */
async function expectEnvelopePair(password: string): Promise<void> {
  const meta = await metaSnapshot();
  expect(meta[StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS]).toBe(ENVELOPE_ITERATIONS);
  const result = await verifyPasswordWithPBKDF2(
    password,
    meta[StorageKeys.MASTER_PASSWORD_HASH] as string,
    base64ToBytes(meta[StorageKeys.MASTER_PASSWORD_SALT] as string),
    ENVELOPE_ITERATIONS
  );
  expect(result).toEqual({ isValid: true, needsRehash: false });
}

beforeEach(async () => {
  clearEncryptionKeyCache();
  vi.clearAllMocks();
  // PBI 25-25: fresh secret generation wraps with the dedicated KEK.
  // Install the in-memory backend (stands in for IndexedDB).
  const { getWebCrypto } = await import('../../crypto/primitives.js');
  const { setSecretKeyStorageOverride } = await import('../../crypto/secretWrappingKey.js');
  const kek = await getWebCrypto().subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  setSecretKeyStorageOverride({
    get: async () => kek,
    put: async () => {},
  });
  // Make sendMessage return a promise so .catch() works in unlockWithPassword
  (chrome.runtime as any).sendMessage = vi.fn().mockResolvedValue(undefined);
  const rateLimiter = await import('../../rateLimiter.js');
  vi.mocked(rateLimiter.checkRateLimit).mockResolvedValue({ success: true });
});

describe('auth-modal self-verify rehash (the regression fixture)', () => {
  it('rehashes a legacy hash and KDF iterations atomically so the next constant-time verify accepts the password', async () => {
    await seedLegacy();

    await expect(verifyMasterPasswordWithRehash(PASSWORD)).resolves.toEqual({ success: true });

    // Exactly one write of the pair — not a raw single-field hash write.
    expect(chrome.storage.local.set).toHaveBeenLastCalledWith({
      [StorageKeys.MASTER_PASSWORD_HASH]: expect.any(String),
      [StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS]: ENVELOPE_ITERATIONS,
    });
    await expectEnvelopePair(PASSWORD);

    // The stored-iterations constant-time verify (unlock path) trusts the
    // stored count; it must accept the migrated state.
    await expect(unlockWithPassword(PASSWORD)).resolves.toBe(true);
  });

  it('documents the old bug shape: a stale stored count next to an envelope hash rejects the correct password', async () => {
    await seedStaleRehash();

    // Constant-time verify computes at the stored (legacy) count and compares
    // against the envelope hash: mismatch on the correct password.
    await expect(unlockWithPassword(PASSWORD)).resolves.toBe(false);
    await expect(verifyMasterPasswordWithRehash(PASSWORD)).resolves.toEqual({
      success: false,
      error: 'Incorrect password',
    });
  });

  it('fails closed on tampered stored iterations and leaves metadata untouched', async () => {
    await seedLegacy();
    await chrome.storage.local.set({ [StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS]: 1 });
    const before = await metaSnapshot();

    await expect(verifyMasterPasswordWithRehash(PASSWORD)).resolves.toEqual({
      success: false,
      error: 'Master password data corrupted',
    });
    expect(await metaSnapshot()).toEqual(before);
  });

  it('returns Master password not set when no password is configured', async () => {
    await expect(verifyMasterPasswordWithRehash(PASSWORD)).resolves.toEqual({
      success: false,
      error: 'Master password not set',
    });
  });
});

describe('rehash policy pin — one policy across all four paths', () => {
  it('set: persists hash and KDF iterations as the envelope pair', async () => {
    await expect(setMasterPassword(PASSWORD)).resolves.toBe(true);

    expect((await metaSnapshot())[StorageKeys.MASTER_PASSWORD_ENABLED]).toBe(true);
    await expectEnvelopePair(PASSWORD);
  });

  it('change: migrates a legacy setup and re-persists the envelope pair for the new password', async () => {
    await seedLegacy();

    await expect(changeMasterPassword(PASSWORD, NEW_PASSWORD)).resolves.toBe(true);

    await expectEnvelopePair(NEW_PASSWORD);
  });

  it('remove: self-verifies with stored iterations and leaves no auth metadata', async () => {
    await seedLegacy();

    await expect(removeMasterPassword(PASSWORD)).resolves.toBeUndefined();

    const meta = await metaSnapshot();
    expect(meta[StorageKeys.MASTER_PASSWORD_ENABLED]).toBeUndefined();
    expect(meta[StorageKeys.MASTER_PASSWORD_HASH]).toBeUndefined();
    expect(meta[StorageKeys.MASTER_PASSWORD_SALT]).toBeUndefined();
  });
});
