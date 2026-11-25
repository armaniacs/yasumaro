/**
 * encryptionSession-cache-invalidation.test.ts (PBI 2026-11-25-02)
 *
 * Verifies cross-context encryption key cache invalidation so a Service Worker
 * never serves a stale pre-delete KEK after another context (e.g. dashboard
 * Delete All / master-password removal) clears or replaces key material in
 * chrome.storage.local.
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

import {
  getOrCreateEncryptionKey,
  clearEncryptionKeyCache,
  handleEncryptionStorageChange,
  isEncryptionLocked,
  setMasterPassword,
  unlockWithPassword,
} from '../encryptionSession.js';
import { clearAllLocalData } from '../storageMaintenance.js';
import { StorageKeys } from '../types.js';
import { encryptApiKey, decryptApiKey } from '../../crypto/index.js';

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
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
});

describe('encryptionSession cross-context cache invalidation (PBI 2026-11-25-02)', () => {
  it('invalidates cached KEK when local encryption_salt/secret are cleared from another context', async () => {
    const firstKey = await getOrCreateEncryptionKey();
    const firstCipher = await encryptApiKey('before-delete', firstKey, 'webhook_export_url');

    // Simulate another context (dashboard) running chrome.storage.local.clear().
    await chrome.storage.local.clear();
    handleEncryptionStorageChange(
      {
        [StorageKeys.ENCRYPTION_SALT]: { oldValue: 'old-salt', newValue: undefined },
        [StorageKeys.ENCRYPTION_SECRET]: { oldValue: 'old-secret', newValue: undefined },
      },
      'local',
    );

    const secondKey = await getOrCreateEncryptionKey();
    expect(secondKey).not.toBe(firstKey);
    // Ciphertext encrypted with the old pre-delete key must NOT decrypt under the new key.
    await expect(decryptApiKey(firstCipher, secondKey, 'webhook_export_url')).rejects.toThrow();
  });

  it('drops cached KEK, master password, and lock requirement when master_password_enabled is removed', async () => {
    await setMasterPassword('ValidPass123!');
    await unlockWithPassword('ValidPass123!');
    const mpKey = await getOrCreateEncryptionKey();

    // Simulate another context wiping storage (Delete All after Master Password).
    await chrome.storage.local.clear();
    handleEncryptionStorageChange(
      {
        [StorageKeys.MASTER_PASSWORD_ENABLED]: { oldValue: true, newValue: undefined },
        [StorageKeys.MASTER_PASSWORD_SALT]: { oldValue: 'old-salt', newValue: undefined },
      },
      'local',
    );

    expect(await isEncryptionLocked()).toBe(false);
    const anonKey = await getOrCreateEncryptionKey();
    expect(anonKey).not.toBe(mpKey);
  });

  it('preserves cachedMasterPassword when master_password_enabled transitions to true', async () => {
    await setMasterPassword('ValidPass123!');
    await unlockWithPassword('ValidPass123!');

    // Notify local storage change for master_password_enabled -> true (setup/change).
    handleEncryptionStorageChange(
      {
        [StorageKeys.MASTER_PASSWORD_ENABLED]: { oldValue: undefined, newValue: true },
      },
      'local',
    );

    // Must still be able to re-derive the master-password KEK without throwing ENCRYPTION_LOCKED.
    const key = await getOrCreateEncryptionKey();
    expect(key).toBeDefined();
  });

  it('ignores non-local storage areas and unrelated keys', async () => {
    const keyBefore = await getOrCreateEncryptionKey();

    handleEncryptionStorageChange(
      { [StorageKeys.ENCRYPTION_SECRET]: { oldValue: 'x', newValue: undefined } },
      'session',
    );
    handleEncryptionStorageChange(
      { unrelated_key: { oldValue: 1, newValue: 2 } },
      'local',
    );

    const keyAfter = await getOrCreateEncryptionKey();
    expect(keyAfter).toBe(keyBefore);
  });

  it('clearAllLocalData clears both chrome.storage.local and the in-memory KEK cache', async () => {
    const beforeKey = await getOrCreateEncryptionKey();
    await clearAllLocalData();
    const afterKey = await getOrCreateEncryptionKey();
    expect(afterKey).not.toBe(beforeKey);
  });
});
