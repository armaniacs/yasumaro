/**
 * encryptionSession-plaintext-fallback-bound.test.ts
 * PBI 2026-11-27-08 (CWE-312 hardening): the plaintext fallback written by the
 * session-rescue path when the secret-KEK store is unreachable must be
 * re-wrapped into an envelope on the next successful unlock — the anonymous
 * read path that normally migrates it never runs while a master password is
 * enabled, so the unlock is the guaranteed retry point that bounds the
 * fallback window.
 *
 * Real WebCrypto (node built-in), Map-backed chrome.storage mocks, reduced
 * KDF iterations, in-memory secret-KEK override.
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

vi.mock('../../rateLimiter.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ success: true }),
  recordFailedAttempt: vi.fn().mockResolvedValue(undefined),
  resetFailedAttempts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../authGuard.js', () => ({
  isLocked: vi.fn().mockResolvedValue(false),
}));

const localData = new Map<string, unknown>();
const sessionData = new Map<string, unknown>();

(global as unknown as { chrome: unknown }).chrome = {
  runtime: {
    sendMessage: vi.fn().mockResolvedValue(undefined),
  },
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[] | null) => {
        if (keys === null) return Object.fromEntries(localData);
        const list = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const k of list) if (localData.has(k)) out[k] = localData.get(k);
        return out;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) localData.set(k, v);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) localData.delete(k);
      }),
    },
    session: {
      get: vi.fn(async (keys: string | string[] | null) => {
        if (keys === null) return Object.fromEntries(sessionData);
        const list = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const k of list) if (sessionData.has(k)) out[k] = sessionData.get(k);
        return out;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) sessionData.set(k, v);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) sessionData.delete(k);
      }),
    },
  },
};

import {
  getOrCreateEncryptionKey,
  unlockWithPassword,
  clearEncryptionKeyCache,
} from '../encryptionSession.js';
import {
  setSecretKeyStorageOverride,
  isSecretEnvelope,
  unwrapSecretWithKey,
  wrapSecretWithKey,
  type SecretEnvelope,
} from '../../crypto/secretWrappingKey.js';
import {
  hashPasswordWithPBKDF2,
  generateSalt,
  bytesToBase64,
  getWebCrypto,
  ENVELOPE_ITERATIONS,
} from '../../crypto/primitives.js';
import { StorageKeys } from '../types.js';

const PASSWORD = 'correct horse battery staple 1!';
const ANON_SALT_BASE64 = bytesToBase64(generateSalt());
const MASTER_SALT = generateSalt();

/** In-memory secret KEK (test-only backend behind the override seam). */
async function installMemoryKek(): Promise<CryptoKey> {
  // Same realm as production (getWebCrypto) — cross-realm CryptoKey breaks.
  const kek = await getWebCrypto().subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  setSecretKeyStorageOverride({
    get: async () => kek,
    put: async () => {},
  });
  return kek;
}

async function seedMasterPasswordMeta(): Promise<void> {
  const hash = await hashPasswordWithPBKDF2(PASSWORD, MASTER_SALT, ENVELOPE_ITERATIONS);
  await chrome.storage.local.set({
    [StorageKeys.MASTER_PASSWORD_ENABLED]: true,
    [StorageKeys.MASTER_PASSWORD_SALT]: bytesToBase64(MASTER_SALT),
    [StorageKeys.MASTER_PASSWORD_HASH]: hash,
    [StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS]: ENVELOPE_ITERATIONS,
  });
}

/** Drive the real fallback origin: KEK store unreachable while a session
 * rescue is pending, so the secret lands in local as legacy plaintext. */
async function enterPlaintextFallback(): Promise<string> {
  const rescued = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
  await chrome.storage.local.set({ [StorageKeys.ENCRYPTION_SALT]: ANON_SALT_BASE64 });
  await chrome.storage.session.set({ [StorageKeys.ENCRYPTION_SECRET]: rescued });
  setSecretKeyStorageOverride(null); // no IndexedDB -> no KEK
  await expect(getOrCreateEncryptionKey()).resolves.toBeDefined();
  expect(localData.get(StorageKeys.ENCRYPTION_SECRET)).toBe(rescued);
  expect(sessionData.has(StorageKeys.ENCRYPTION_SECRET)).toBe(false);
  return rescued;
}

beforeEach(() => {
  localData.clear();
  sessionData.clear();
  vi.clearAllMocks();
  (chrome.runtime as { sendMessage: unknown }).sendMessage = vi.fn().mockResolvedValue(undefined);
  clearEncryptionKeyCache();
  setSecretKeyStorageOverride(null);
});

describe('post-unlock plaintext fallback retry-wrap (PBI 2026-11-27-08)', () => {
  it('re-wraps the fallback plaintext into an envelope on the next successful unlock', async () => {
    const rescued = await enterPlaintextFallback();

    const kek = await installMemoryKek();
    await seedMasterPasswordMeta();
    clearEncryptionKeyCache();

    await expect(unlockWithPassword(PASSWORD)).resolves.toBe(true);

    const stored = localData.get(StorageKeys.ENCRYPTION_SECRET);
    expect(isSecretEnvelope(stored)).toBe(true);
    await expect(unwrapSecretWithKey(stored as SecretEnvelope, kek)).resolves.toBe(rescued);
  });

  it('keeps the fallback plaintext untouched when the unlock fails', async () => {
    await enterPlaintextFallback();
    await installMemoryKek();
    await seedMasterPasswordMeta();
    clearEncryptionKeyCache();

    await expect(unlockWithPassword('wrong password attempt')).resolves.toBe(false);

    expect(typeof localData.get(StorageKeys.ENCRYPTION_SECRET)).toBe('string');
  });

  it('defers the wrap without failing the unlock when the KEK store is still unreachable', async () => {
    await enterPlaintextFallback();
    await seedMasterPasswordMeta();
    clearEncryptionKeyCache();
    // setSecretKeyStorageOverride(null) is still in effect: no KEK store.

    await expect(unlockWithPassword(PASSWORD)).resolves.toBe(true);
    expect(typeof localData.get(StorageKeys.ENCRYPTION_SECRET)).toBe('string');
  });

  it('leaves an already-wrapped envelope alone on unlock', async () => {
    const kek = await installMemoryKek();
    const secret = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
    const envelope = await wrapSecretWithKey(secret, kek);
    await chrome.storage.local.set({
      [StorageKeys.ENCRYPTION_SALT]: ANON_SALT_BASE64,
      [StorageKeys.ENCRYPTION_SECRET]: envelope,
    });
    await seedMasterPasswordMeta();
    clearEncryptionKeyCache();

    await expect(unlockWithPassword(PASSWORD)).resolves.toBe(true);

    const stored = localData.get(StorageKeys.ENCRYPTION_SECRET) as SecretEnvelope;
    expect(stored).toEqual(envelope);
    await expect(unwrapSecretWithKey(stored, kek)).resolves.toBe(secret);
  });
});
