/**
 * encryptionSession-anon-kek.test.ts
 * The anonymous KEK must never regenerate a salt+secret pair over a partially
 * present record: doing so orphans every stored API key ciphertext.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../crypto/cryptoParams.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../crypto/cryptoParams.js')>();
  return {
    ...actual,
    CRYPTO_PARAMS: { ...actual.CRYPTO_PARAMS, PBKDF2_ITERATIONS: 1_000, LEGACY_PBKDF2_ITERATIONS: 100 },
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

import { getOrCreateEncryptionKey, clearEncryptionKeyCache } from '../encryptionSession.js';
import { StorageKeys } from '../types.js';

const SALT_BASE64 = btoa(String.fromCharCode(...new Uint8Array(16).fill(7)));
const SECRET_BASE64 = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));

async function snapshot(): Promise<Record<string, unknown>> {
  return chrome.storage.local.get([StorageKeys.ENCRYPTION_SALT, StorageKeys.ENCRYPTION_SECRET]);
}

beforeEach(async () => {
  clearEncryptionKeyCache();
  vi.clearAllMocks();
  const { getWebCrypto } = await import('../../crypto/primitives.js');
  const { setSecretKeyStorageOverride } = await import('../../crypto/secretWrappingKey.js');
  const kek = await getWebCrypto().subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  setSecretKeyStorageOverride({ get: async () => kek, put: async () => {} });
  await chrome.storage.local.remove([
    StorageKeys.MASTER_PASSWORD_ENABLED,
    StorageKeys.ENCRYPTION_SALT,
    StorageKeys.ENCRYPTION_SECRET,
  ]);
  await chrome.storage.session.remove(StorageKeys.ENCRYPTION_SECRET);
});

describe('getOrCreateAnonymousSecretKey partial-record handling', () => {
  it('fails closed when salt exists, secret is missing and session rescue finds nothing', async () => {
    await chrome.storage.local.set({ [StorageKeys.ENCRYPTION_SALT]: SALT_BASE64 });

    const error = await getOrCreateEncryptionKey().then(
      () => null,
      (e: Error) => e,
    );

    expect(error?.message).toMatch(/^CORRUPTION: encryption secret missing/);
    expect(error?.message).not.toContain(SALT_BASE64);
    const after = await snapshot();
    expect(after[StorageKeys.ENCRYPTION_SALT]).toBe(SALT_BASE64);
    expect(after[StorageKeys.ENCRYPTION_SECRET]).toBeUndefined();
  });

  it('keeps failing closed on repeated calls without mutating storage', async () => {
    await chrome.storage.local.set({ [StorageKeys.ENCRYPTION_SALT]: SALT_BASE64 });

    await expect(getOrCreateEncryptionKey()).rejects.toThrow('CORRUPTION');
    await expect(getOrCreateEncryptionKey()).rejects.toThrow('CORRUPTION');
    expect((await snapshot())[StorageKeys.ENCRYPTION_SALT]).toBe(SALT_BASE64);
  });

  it('still rescues the secret from session storage when salt exists', async () => {
    await chrome.storage.local.set({ [StorageKeys.ENCRYPTION_SALT]: SALT_BASE64 });
    await chrome.storage.session.set({ [StorageKeys.ENCRYPTION_SECRET]: SECRET_BASE64 });

    await expect(getOrCreateEncryptionKey()).resolves.toBeDefined();

    const after = await snapshot();
    expect(after[StorageKeys.ENCRYPTION_SALT]).toBe(SALT_BASE64);
    expect(after[StorageKeys.ENCRYPTION_SECRET]).toBeDefined();
  });

  it('keeps the CORRUPTION throw for secret present without salt', async () => {
    await chrome.storage.local.set({ [StorageKeys.ENCRYPTION_SECRET]: SECRET_BASE64 });

    await expect(getOrCreateEncryptionKey()).rejects.toThrow('CORRUPTION: encryption salt missing');
    const after = await snapshot();
    expect(after[StorageKeys.ENCRYPTION_SALT]).toBeUndefined();
    expect(after[StorageKeys.ENCRYPTION_SECRET]).toBeDefined();
  });

  it('generates and persists a fresh pair on a true fresh install', async () => {
    await expect(getOrCreateEncryptionKey()).resolves.toBeDefined();

    const after = await snapshot();
    expect(typeof after[StorageKeys.ENCRYPTION_SALT]).toBe('string');
    expect(after[StorageKeys.ENCRYPTION_SECRET]).toBeDefined();
  });
});
