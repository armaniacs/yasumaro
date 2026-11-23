/**
 * encryptionSession-forgot-recovery.test.ts
 * PBI 2026-11-23-04: master password forgot recovery (Outside-In, RED first).
 *
 * Forgot path deletes ONLY protection auth records + API keys. Other
 * settings survive. The normal remove path keeps requiring the old password.
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
  setMasterPassword,
  unlockWithPassword,
  removeMasterPassword,
  recoverForgotMasterPassword,
  isMasterPasswordEnabled,
  clearEncryptionKeyCache,
} from '../encryptionSession.js';
import { StorageKeys } from '../types.js';
import type { EncryptedData } from '../../crypto/types.js';
import { encryptApiKey, decryptApiKey } from '../../crypto/index.js';

vi.mock('../../rateLimiter.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ success: true }),
  recordFailedAttempt: vi.fn().mockResolvedValue(undefined),
  resetFailedAttempts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../authGuard.js', () => ({
  isLocked: vi.fn().mockResolvedValue(false),
}));

const PROTECTION_KEYS = [
  StorageKeys.MASTER_PASSWORD_ENABLED,
  StorageKeys.MASTER_PASSWORD_SALT,
  StorageKeys.MASTER_PASSWORD_HASH,
  StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS,
  StorageKeys.MASTER_PASSWORD_PENDING_SALT,
  StorageKeys.MASTER_PASSWORD_PENDING_HASH,
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

async function seedCiphertext(field: string, plaintext: string): Promise<EncryptedData> {
  const { getOrCreateEncryptionKey } = await import('../encryptionSession.js');
  const key = await getOrCreateEncryptionKey();
  const envelope = await encryptApiKey(plaintext, key, field);
  const cur = (await chrome.storage.local.get('settings')) as Record<string, unknown>;
  const blob = (cur['settings'] as Record<string, unknown>) ?? {};
  await chrome.storage.local.set({ settings: { ...blob, [field]: envelope } });
  return envelope;
}

describe('recoverForgotMasterPassword (Outside-In)', () => {
  it('BDD: disables protection and deletes API keys without the old password, keeps other settings', async () => {
    await setMasterPassword('OldP@ssw0rd123!');
    await unlockWithPassword('OldP@ssw0rd123!');
    await seedCiphertext('obsidian_api_key', 'sk-live-obsidian');
    await seedCiphertext('gemini_api_key', 'sk-live-gemini');
    await chrome.storage.local.set({ [StorageKeys.OBSIDIAN_HOST]: '127.0.0.1' });

    await recoverForgotMasterPassword();

    expect(await isMasterPasswordEnabled()).toBe(false);
    const stored = await chrome.storage.local.get([...PROTECTION_KEYS]);
    for (const key of PROTECTION_KEYS) {
      expect(stored[key]).toBeUndefined();
    }
    const settings = ((await chrome.storage.local.get('settings')) as Record<string, unknown>)[
      'settings'
    ] as Record<string, unknown>;
    expect(settings?.['obsidian_api_key']).toBeUndefined();
    expect(settings?.['gemini_api_key']).toBeUndefined();
    // Other settings survive.
    const host = await chrome.storage.local.get(StorageKeys.OBSIDIAN_HOST);
    expect(host[StorageKeys.OBSIDIAN_HOST]).toBe('127.0.0.1');
  });

  it('rejects when protection is not enabled (nothing to recover)', async () => {
    await expect(recoverForgotMasterPassword()).rejects.toThrow('Master password not enabled');
  });

  it('normal remove path still requires the old password (unchanged)', async () => {
    await setMasterPassword('OldP@ssw0rd123!');
    await unlockWithPassword('OldP@ssw0rd123!');
    await seedCiphertext('openai_api_key', 'sk-live-oai');
    clearEncryptionKeyCache();
    const metaBefore = await chrome.storage.local.get([...PROTECTION_KEYS]);

    await expect(removeMasterPassword()).rejects.toThrow('ENCRYPTION_LOCKED');
    expect(await chrome.storage.local.get([...PROTECTION_KEYS])).toEqual(metaBefore);
    // Decrypting without recovery is impossible: the ciphertext is untouched.
    const settings = ((await chrome.storage.local.get('settings')) as Record<string, unknown>)[
      'settings'
    ] as Record<string, unknown>;
    expect(settings?.['openai_api_key']).toBeDefined();
    void decryptApiKey;
  });
});
