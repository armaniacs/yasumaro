/**
 * Cross-context mutual exclusion for master password rotation: while another
 * context holds the rotation lock, set/change/remove must fail fast with
 * RotationInProgressError and leave ciphertext and auth metadata untouched.
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
} from '../encryptionSession.js';
import { ROTATION_LOCK_NAME, RotationInProgressError } from '../rotationLock.js';
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
  (chrome.runtime as unknown as { sendMessage: unknown }).sendMessage = vi.fn().mockResolvedValue(undefined);
});

async function snapshotAuth(): Promise<Record<string, unknown>> {
  return (await chrome.storage.local.get([...AUTH_KEYS])) as Record<string, unknown>;
}

async function withForeignHolder<T>(body: () => Promise<T>): Promise<T> {
  let release!: () => void;
  let acquired!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  const ready = new Promise<void>((r) => {
    acquired = r;
  });
  const holder = navigator.locks.request(ROTATION_LOCK_NAME, async () => {
    acquired();
    await held;
  });
  await ready;
  try {
    return await body();
  } finally {
    release();
    await holder;
  }
}

describe('rotation lock integration', () => {
  it('set is refused while another context holds the lock and writes nothing', async () => {
    const setSpy = vi.spyOn(chrome.storage.local, 'set');
    await expect(
      withForeignHolder(() => setMasterPassword('NewP@ssw0rd123!')),
    ).rejects.toBeInstanceOf(RotationInProgressError);
    expect(setSpy).not.toHaveBeenCalled();
    const snapshot = await snapshotAuth();
    expect(snapshot[StorageKeys.MASTER_PASSWORD_ENABLED]).toBeUndefined();
    expect(snapshot[StorageKeys.MASTER_PASSWORD_PENDING_SALT]).toBeUndefined();
  });

  it('change is refused while another context holds the lock and leaves auth metadata untouched', async () => {
    await setMasterPassword('OldP@ssw0rd123!');
    const before = await snapshotAuth();
    await expect(
      withForeignHolder(() => changeMasterPassword('OldP@ssw0rd123!', 'NewP@ssw0rd123!')),
    ).rejects.toBeInstanceOf(RotationInProgressError);
    const after = await snapshotAuth();
    expect(after[StorageKeys.MASTER_PASSWORD_SALT]).toBe(before[StorageKeys.MASTER_PASSWORD_SALT]);
    expect(after[StorageKeys.MASTER_PASSWORD_HASH]).toBe(before[StorageKeys.MASTER_PASSWORD_HASH]);
    expect(after[StorageKeys.MASTER_PASSWORD_ENABLED]).toBe(before[StorageKeys.MASTER_PASSWORD_ENABLED]);
    expect(after[StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS]).toBe(
      before[StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS],
    );
    expect(after[StorageKeys.MASTER_PASSWORD_PENDING_SALT]).toBe(before[StorageKeys.MASTER_PASSWORD_PENDING_SALT]);
    expect(await unlockWithPassword('OldP@ssw0rd123!')).toBe(true);
  });

  it('remove is refused while another context holds the lock and keeps the password enabled', async () => {
    await setMasterPassword('OldP@ssw0rd123!');
    const setSpy = vi.spyOn(chrome.storage.local, 'set');
    const removeSpy = vi.spyOn(chrome.storage.local, 'remove');
    // Drop the setup writes above: only the holder window is under test.
    setSpy.mockClear();
    removeSpy.mockClear();
    await expect(
      withForeignHolder(() => removeMasterPassword('OldP@ssw0rd123!')),
    ).rejects.toBeInstanceOf(RotationInProgressError);
    expect(await isMasterPasswordEnabled()).toBe(true);
    expect(setSpy).not.toHaveBeenCalled();
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('two simultaneous sets: exactly one wins', async () => {
    const [a, b] = await Promise.allSettled([
      setMasterPassword('FirstP@ssw0rd123!'),
      setMasterPassword('SecondP@ssw0rd456!'),
    ]);
    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('rejected');
    if (b.status === 'rejected') {
      expect(b.reason).toBeInstanceOf(RotationInProgressError);
    }
    expect(await unlockWithPassword('FirstP@ssw0rd123!')).toBe(true);
  });

  it('releases the lock after success and after a failed operation', async () => {
    await setMasterPassword('NewP@ssw0rd123!');
    await setMasterPassword('NewP@ssw0rd123!').catch(() => undefined);
    const held = ((await navigator.locks.query()).held ?? []).map((entry) => entry.name);
    expect(held).not.toContain(ROTATION_LOCK_NAME);
  });

  it('sequential set, change, remove all succeed in one context', async () => {
    await setMasterPassword('OldP@ssw0rd123!');
    expect(await changeMasterPassword('OldP@ssw0rd123!', 'NewP@ssw0rd123!')).toBe(true);
    await removeMasterPassword('NewP@ssw0rd123!');
    expect(await isMasterPasswordEnabled()).toBe(false);
  });

  it('error text carries no password', async () => {
    const error = await withForeignHolder(() =>
      setMasterPassword('NewP@ssw0rd123!'),
    ).catch((e: Error) => e);
    expect((error as Error).message).not.toContain('NewP@ssw0rd123!');
  });
});
