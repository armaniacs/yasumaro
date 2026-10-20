/**
 * encryptionSession-kdf-delegation-pin.test.ts
 *
 * Pins the KDF delegation introduced by PBI 10: deriveKeyFromPassword now
 * delegates the PBKDF2 importKey/deriveKey boilerplate to the shared
 * crypto/primitives deriveKey, so the session key must stay byte-identical
 * to a direct deriveKey over the same password, salt, and iteration count
 * (the BDD "derive key equivalence" scenario). CryptoKeys are opaque, so the
 * equivalence is proven by cross-decrypting AES-GCM ciphertexts.
 *
 * Also pins the one shared secret generator: both the encryption secret and
 * the HMAC signing secret are 32 random bytes, base64-encoded (44 chars).
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
  unlockWithPassword,
  changeMasterPassword,
  getOrCreateEncryptionKey,
  getOrCreateHmacSecret,
  clearEncryptionKeyCache,
} from '../encryptionSession.js';
import {
  deriveKey,
  base64ToBytes,
  encryptApiKey,
  decryptApiKey,
  unwrapSecretString,
  isWrappedSecretString,
} from '../../crypto/index.js';
import {
  getWebCrypto,
  ENVELOPE_ITERATIONS,
} from '../../crypto/primitives.js';
import {
  setSecretKeyStorageOverride,
  unwrapSecretWithKey,
  type SecretEnvelope,
} from '../../crypto/secretWrappingKey.js';
import { StorageKeys } from '../types.js';

const OLD_PASSWORD = 'correct horse battery staple 1!';
const NEW_PASSWORD = 'correct horse battery staple 2?';

/**
 * Cross-check that two derived keys are the same key: a message sealed under
 * one must open under the other, and vice versa. CryptoKey objects are
 * opaque, so ciphertext cross-decryption is the observable proof.
 */
async function expectSameKey(a: CryptoKey, b: CryptoKey): Promise<void> {
  const plaintext = new TextEncoder().encode('kdf-delegation-pin');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealedByA = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, a, plaintext);
  await expect(
    new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, b, sealedByA)),
  ).toBe('kdf-delegation-pin');
  const sealedByB = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, b, plaintext);
  await expect(
    new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, a, sealedByB)),
  ).toBe('kdf-delegation-pin');
}

async function storedSaltBase64(): Promise<string> {
  const stored = (await chrome.storage.local.get(StorageKeys.MASTER_PASSWORD_SALT))[
    StorageKeys.MASTER_PASSWORD_SALT
  ];
  return stored as string;
}

/** 32 random bytes are 44 base64 characters (4 * ceil(32 / 3)): 43 payload
 * characters plus one '=' pad (32 = 3 * 10 + 2). */
function expectSecretShape(secret: string): void {
  expect(secret.length).toBe(44);
  expect(secret).toMatch(/^[A-Za-z0-9+/]{43}=$/);
}

beforeEach(async () => {
  clearEncryptionKeyCache();
  vi.clearAllMocks();
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  // Make sendMessage return a promise so .catch() works in unlockWithPassword.
  (chrome.runtime as any).sendMessage = vi.fn().mockResolvedValue(undefined);
});

describe('deriveKeyFromPassword delegates to the shared PBKDF2 primitive (PBI 10)', () => {
  it('derives a session key identical to deriveKey over the same password, salt, and iteration count', async () => {
    await expect(setMasterPassword(OLD_PASSWORD)).resolves.toBe(true);
    await expect(unlockWithPassword(OLD_PASSWORD)).resolves.toBe(true);

    const sessionKey = await getOrCreateEncryptionKey();
    const expected = await deriveKey(
      OLD_PASSWORD,
      base64ToBytes(await storedSaltBase64()),
      ENVELOPE_ITERATIONS,
    );
    await expectSameKey(sessionKey, expected);
  });

  it('re-encrypts stored API keys under a KEK that deriveKey reproduces at ENVELOPE_ITERATIONS', async () => {
    await expect(setMasterPassword(OLD_PASSWORD)).resolves.toBe(true);
    await expect(unlockWithPassword(OLD_PASSWORD)).resolves.toBe(true);
    const oldKey = await getOrCreateEncryptionKey();
    await chrome.storage.local.set({
      settings: { obsidian_api_key: await encryptApiKey('sk-live-obsidian', oldKey, 'obsidian_api_key') },
    });
    clearEncryptionKeyCache();

    await expect(changeMasterPassword(OLD_PASSWORD, NEW_PASSWORD)).resolves.toBe(true);

    await expect(unlockWithPassword(NEW_PASSWORD)).resolves.toBe(true);
    const sessionKey = await getOrCreateEncryptionKey();
    const expected = await deriveKey(
      NEW_PASSWORD,
      base64ToBytes(await storedSaltBase64()),
      ENVELOPE_ITERATIONS,
    );
    await expectSameKey(sessionKey, expected);

    // The rotation KEK is exactly the shared primitive's key: the migrated
    // ciphertext opens under it with the field-bound AAD.
    const stored = (await chrome.storage.local.get('settings')) as Record<string, unknown>;
    const blob = stored['settings'] as Record<string, unknown>;
    await expect(
      decryptApiKey(blob['obsidian_api_key'] as never, expected, 'obsidian_api_key'),
    ).resolves.toBe('sk-live-obsidian');
  });
});

describe('the one shared secret generator (PBI 10)', () => {
  it('generates a 32-byte base64 HMAC signing secret and stores it wrapped', async () => {
    const secret = await getOrCreateHmacSecret();
    expectSecretShape(secret);

    const stored = (await chrome.storage.local.get(StorageKeys.HMAC_SECRET))[
      StorageKeys.HMAC_SECRET
    ];
    expect(isWrappedSecretString(stored)).toBe(true);
    // The stored envelope unwraps back to the generated secret.
    await expect(unwrapSecretString(stored as { wrapped: string; iv: string })).resolves.toBe(secret);
  });

  it('generates a 32-byte base64 encryption secret and stores it wrapped with the dedicated KEK', async () => {
    // Fresh install: getOrCreateEncryptionKey generates the salt + secret pair.
    const kek = await getWebCrypto().subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    setSecretKeyStorageOverride({ get: async () => kek, put: async () => {} });
    await expect(getOrCreateEncryptionKey()).resolves.toBeDefined();

    const stored = (await chrome.storage.local.get(StorageKeys.ENCRYPTION_SECRET))[
      StorageKeys.ENCRYPTION_SECRET
    ] as SecretEnvelope;
    const secret = await unwrapSecretWithKey(stored, kek);
    expectSecretShape(secret);
  });
});
