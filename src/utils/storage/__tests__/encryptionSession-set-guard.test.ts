/**
 * setMasterPassword must refuse to run while a master password already
 * exists: without the old password, set would overwrite salt/hash/enabled.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
import {
  setMasterPassword,
  changeMasterPassword,
  removeMasterPassword,
  unlockWithPassword,
  isMasterPasswordEnabled,
  clearEncryptionKeyCache,
  MasterPasswordAlreadySetError,
} from '../encryptionSession.js';
import { StorageKeys } from '../types.js';

vi.mock('../../rateLimiter.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ success: true }),
  recordFailedAttempt: vi.fn().mockResolvedValue(undefined),
  resetFailedAttempts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../authGuard.js', () => ({
  isLocked: vi.fn().mockResolvedValue(false),
}));

const AUTH_KEYS = [
  StorageKeys.MASTER_PASSWORD_ENABLED,
  StorageKeys.MASTER_PASSWORD_SALT,
  StorageKeys.MASTER_PASSWORD_HASH,
  StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS,
  StorageKeys.MASTER_PASSWORD_PENDING_SALT,
  StorageKeys.IS_LOCKED,
] as const;

beforeEach(async () => {
  clearEncryptionKeyCache();
  vi.clearAllMocks();
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  const { getWebCrypto } = await import('../../crypto/primitives.js');
  const { setSecretKeyStorageOverride } = await import('../../crypto/secretWrappingKey.js');
  const kek = await getWebCrypto().subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  setSecretKeyStorageOverride({ get: async () => kek, put: async () => {} });
  (chrome.runtime as any).sendMessage = vi.fn().mockResolvedValue(undefined);
});

async function snapshotAuth(): Promise<Record<string, unknown>> {
  return (await chrome.storage.local.get([...AUTH_KEYS])) as Record<string, unknown>;
}

describe('setMasterPassword takeover guard', () => {
  it('refuses when a master password is already set and leaves auth metadata untouched', async () => {
    await setMasterPassword('OldP@ssw0rd123!');
    const before = await snapshotAuth();

    await expect(setMasterPassword('AttackerP@ss123!')).rejects.toBeInstanceOf(MasterPasswordAlreadySetError);

    expect(await snapshotAuth()).toEqual(before);
  });

  it('refuses even when the session is unlocked and no ciphertext exists (fast path)', async () => {
    await setMasterPassword('OldP@ssw0rd123!');
    await unlockWithPassword('OldP@ssw0rd123!');
    const before = await snapshotAuth();

    await expect(setMasterPassword('AttackerP@ss123!')).rejects.toBeInstanceOf(MasterPasswordAlreadySetError);

    expect(await snapshotAuth()).toEqual(before);
    expect(await unlockWithPassword('OldP@ssw0rd123!')).toBe(true);
  });

  it('does not reveal or embed password values in the error', async () => {
    await setMasterPassword('OldP@ssw0rd123!');
    const err = await setMasterPassword('AttackerP@ss123!').catch((e: Error) => e);
    expect((err as Error).message).not.toContain('AttackerP@ss123!');
    expect((err as Error).message).not.toContain('OldP@ssw0rd123!');
  });

  it('succeeds on a fresh install (ENABLED absent)', async () => {
    expect(await setMasterPassword('NewP@ssw0rd123!')).toBe(true);
    expect(await isMasterPasswordEnabled()).toBe(true);
    const meta = await snapshotAuth();
    expect(meta[StorageKeys.IS_LOCKED]).toBe(true);
    expect(meta[StorageKeys.MASTER_PASSWORD_HASH]).toBeDefined();
  });

  it('succeeds again after the master password was removed', async () => {
    await setMasterPassword('OldP@ssw0rd123!');
    await removeMasterPassword('OldP@ssw0rd123!');
    expect(await setMasterPassword('NewP@ssw0rd123!')).toBe(true);
  });

  it('keeps the change flow working while a password is set', async () => {
    await setMasterPassword('OldP@ssw0rd123!');
    expect(await changeMasterPassword('OldP@ssw0rd123!', 'NewP@ssw0rd123!')).toBe(true);
    expect(await unlockWithPassword('NewP@ssw0rd123!')).toBe(true);
  });
});
