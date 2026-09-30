/**
 * encryptionSession-pending-binding.test.ts
 *
 * KEK rotation anchor binding: the interrupted-rotation anchor carries the
 * new-password hash next to the pending salt, so a retry with a different
 * password is rejected before any write while the original password resumes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// PBKDF2 at the production 600,000 iterations dominates runtime; the KDF only
// needs to behave here, not to be expensive.
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
  getOrCreateEncryptionKey,
  setMasterPassword,
  unlockWithPassword,
  changeMasterPassword,
  clearEncryptionKeyCache,
  PendingRotationMismatchError,
} from '../encryptionSession.js';
import { encryptApiKey, generateSalt, bytesToBase64 } from '../../crypto/index.js';
import { StorageKeys } from '../types.js';
import { ReencryptionAbortedError } from '../apiKeyTransition.js';
import type { EncryptedData } from '../../crypto/types.js';

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
  setSecretKeyStorageOverride({
    get: async () => kek,
    put: async () => {},
  });
  (chrome.runtime as any).sendMessage = vi.fn().mockResolvedValue(undefined);
  const rateLimiter = await import('../../rateLimiter.js');
  vi.mocked(rateLimiter.checkRateLimit).mockResolvedValue({ success: true });
});

async function seedNestedCiphertext(field: string, plaintext: string): Promise<EncryptedData> {
  const key = await getOrCreateEncryptionKey();
  const envelope = await encryptApiKey(plaintext, key, field);
  const cur = (await chrome.storage.local.get('settings')) as Record<string, unknown>;
  const blob = (cur['settings'] as Record<string, unknown>) ?? {};
  await chrome.storage.local.set({ settings: { ...blob, [field]: envelope } });
  return envelope;
}

const GARBAGE_FIELD = 'provider_api_key';

async function interruptRotationWithFirstPassword(): Promise<unknown> {
  await seedNestedCiphertext('obsidian_api_key', 'sk-live-obsidian');
  await chrome.storage.local.set({
    [GARBAGE_FIELD]: { ciphertext: btoa('unrelated-ciphertext-payload-000'), iv: btoa('unrelated-iv-0') },
  });
  const first = await setMasterPassword('FirstP@ssw0rd123!').catch((e: unknown) => e);
  expect(first).toBeInstanceOf(ReencryptionAbortedError);
  return first;
}

describe('encryptionSession pending anchor password binding', () => {
  it('records the password hash next to the pending salt when a rotation is interrupted', async () => {
    await interruptRotationWithFirstPassword();
    const pending = await chrome.storage.local.get([
      StorageKeys.MASTER_PASSWORD_PENDING_SALT,
      StorageKeys.MASTER_PASSWORD_PENDING_HASH,
    ]);
    expect(typeof pending[StorageKeys.MASTER_PASSWORD_PENDING_SALT]).toBe('string');
    expect(typeof pending[StorageKeys.MASTER_PASSWORD_PENDING_HASH]).toBe('string');
  });

  it('rejects a different password with PendingRotationMismatchError and changes nothing', async () => {
    await interruptRotationWithFirstPassword();
    const authBefore = await chrome.storage.local.get([...AUTH_KEYS]);
    const anchorBefore = await chrome.storage.local.get([
      StorageKeys.MASTER_PASSWORD_PENDING_SALT,
      StorageKeys.MASTER_PASSWORD_PENDING_HASH,
    ]);
    const settingsBefore = JSON.stringify(
      ((await chrome.storage.local.get('settings')) as Record<string, unknown>)['settings'],
    );
    const garbageBefore = JSON.stringify(await chrome.storage.local.get(GARBAGE_FIELD));

    const error = await setMasterPassword('SecondP@ssw0rd123!').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PendingRotationMismatchError);
    expect(error).not.toBeInstanceOf(ReencryptionAbortedError);
    expect(await chrome.storage.local.get([...AUTH_KEYS])).toEqual(authBefore);
    expect(
      await chrome.storage.local.get([
        StorageKeys.MASTER_PASSWORD_PENDING_SALT,
        StorageKeys.MASTER_PASSWORD_PENDING_HASH,
      ]),
    ).toEqual(anchorBefore);
    expect(
      JSON.stringify(((await chrome.storage.local.get('settings')) as Record<string, unknown>)['settings']),
    ).toBe(settingsBefore);
    expect(JSON.stringify(await chrome.storage.local.get(GARBAGE_FIELD))).toBe(garbageBefore);
    expect((error as Error).message).not.toContain('FirstP@ssw0rd123!');
    expect((error as Error).message).not.toContain('SecondP@ssw0rd123!');
  });

  it('resumes with the same password (guard passes, then the normal abort path runs)', async () => {
    await interruptRotationWithFirstPassword();
    const anchorBefore = await chrome.storage.local.get(StorageKeys.MASTER_PASSWORD_PENDING_SALT);
    const error = await setMasterPassword('FirstP@ssw0rd123!').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReencryptionAbortedError);
    expect(error).not.toBeInstanceOf(PendingRotationMismatchError);
    const anchorAfter = await chrome.storage.local.get(StorageKeys.MASTER_PASSWORD_PENDING_SALT);
    expect(anchorAfter[StorageKeys.MASTER_PASSWORD_PENDING_SALT]).toBe(
      anchorBefore[StorageKeys.MASTER_PASSWORD_PENDING_SALT],
    );
  });

  it('accepts a legacy anchor that has a salt but no hash', async () => {
    await chrome.storage.local.set({
      [StorageKeys.MASTER_PASSWORD_PENDING_SALT]: bytesToBase64(generateSalt()),
    });
    const ok = await setMasterPassword('LegacyP@ssw0rd123!');
    expect(ok).toBe(true);
    const pending = await chrome.storage.local.get([
      StorageKeys.MASTER_PASSWORD_PENDING_SALT,
      StorageKeys.MASTER_PASSWORD_PENDING_HASH,
    ]);
    expect(pending[StorageKeys.MASTER_PASSWORD_PENDING_SALT]).toBeUndefined();
    expect(pending[StorageKeys.MASTER_PASSWORD_PENDING_HASH]).toBeUndefined();
  });

  it('removes both anchor keys after a successful rotation', async () => {
    const ok = await setMasterPassword('NewP@ssw0rd123!');
    expect(ok).toBe(true);
    const pending = await chrome.storage.local.get([
      StorageKeys.MASTER_PASSWORD_PENDING_SALT,
      StorageKeys.MASTER_PASSWORD_PENDING_HASH,
    ]);
    expect(pending[StorageKeys.MASTER_PASSWORD_PENDING_SALT]).toBeUndefined();
    expect(pending[StorageKeys.MASTER_PASSWORD_PENDING_HASH]).toBeUndefined();
  });

  it('binds the change flow too', async () => {
    await setMasterPassword('OldP@ssw0rd123!');
    await unlockWithPassword('OldP@ssw0rd123!');
    await seedNestedCiphertext('obsidian_api_key', 'sk-live-obsidian');
    await chrome.storage.local.set({
      [GARBAGE_FIELD]: { ciphertext: btoa('unrelated-ciphertext-payload-000'), iv: btoa('unrelated-iv-0') },
    });
    const aborted = await changeMasterPassword('OldP@ssw0rd123!', 'FirstNew1!Passw0rd').catch((e: unknown) => e);
    expect(aborted).toBeInstanceOf(ReencryptionAbortedError);
    const mismatch = await changeMasterPassword('OldP@ssw0rd123!', 'OtherNew1!Passw0rd').catch((e: unknown) => e);
    expect(mismatch).toBeInstanceOf(PendingRotationMismatchError);
  });
});
