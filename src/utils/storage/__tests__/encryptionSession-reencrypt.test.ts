/**
 * encryptionSession-reencrypt.test.ts
 *
 * Integration coverage for the master-password KEK rotation: the shared
 * re-encryption procedure across set / change / remove, the abort path, and
 * metadata discipline (untouched until read-back verification passes).
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
  isMasterPasswordEnabled,
  setMasterPassword,
  unlockWithPassword,
  changeMasterPassword,
  removeMasterPassword,
  clearEncryptionKeyCache,
} from '../encryptionSession.js';
import { encryptApiKey, decryptApiKey } from '../../crypto/index.js';
import { StorageKeys } from '../types.js';
import { API_KEY_FIELD_NAMES } from '../apiKeyFields.js';
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

async function snapshotAuth(): Promise<Record<string, unknown>> {
  return (await chrome.storage.local.get([...AUTH_KEYS])) as Record<string, unknown>;
}

async function seedCiphertext(
  field: string,
  placement: 'nested' | 'scattered',
  plaintext: string,
): Promise<EncryptedData> {
  const key = await getOrCreateEncryptionKey();
  const envelope = await encryptApiKey(plaintext, key);
  if (placement === 'nested') {
    const cur = (await chrome.storage.local.get('settings')) as Record<string, unknown>;
    const blob = (cur['settings'] as Record<string, unknown>) ?? {};
    await chrome.storage.local.set({ settings: { ...blob, [field]: envelope } });
  } else {
    await chrome.storage.local.set({ [field]: envelope });
  }
  return envelope;
}

async function readStored(field: string, placement: 'nested' | 'scattered'): Promise<unknown> {
  if (placement === 'nested') {
    const cur = (await chrome.storage.local.get('settings')) as Record<string, unknown>;
    return (cur['settings'] as Record<string, unknown> | undefined)?.[field];
  }
  const cur = (await chrome.storage.local.get(field)) as Record<string, unknown>;
  return cur[field];
}

describe('encryptionSession KEK rotation', () => {
  describe('KEK rotation — set', () => {
    it('migrates nested and scattered fields to the new KEK and writes metadata after verification', async () => {
      await seedCiphertext('obsidian_api_key', 'nested', 'sk-live-obsidian');
      await seedCiphertext('github_pat', 'scattered', 'ghp_live514');
      const beforeNested = (await readStored('obsidian_api_key', 'nested')) as EncryptedData;
      const beforeScattered = (await readStored('github_pat', 'scattered')) as EncryptedData;

      const ok = await setMasterPassword('NewP@ssw0rd123!');
      expect(ok).toBe(true);

      // Metadata written, locked, pending anchor cleaned.
      const meta = await snapshotAuth();
      expect(meta[StorageKeys.MASTER_PASSWORD_ENABLED]).toBe(true);
      expect(meta[StorageKeys.MASTER_PASSWORD_SALT]).toBeDefined();
      expect(meta[StorageKeys.MASTER_PASSWORD_HASH]).toBeDefined();
      expect(meta[StorageKeys.IS_LOCKED]).toBe(true);
      const pending = await chrome.storage.local.get(StorageKeys.MASTER_PASSWORD_PENDING_SALT);
      expect(pending[StorageKeys.MASTER_PASSWORD_PENDING_SALT]).toBeUndefined();

      // New KEK opens the migrated values; the old envelopes do not.
      await unlockWithPassword('NewP@ssw0rd123!');
      const nextKey = await getOrCreateEncryptionKey();
      const afterNested = (await readStored('obsidian_api_key', 'nested')) as EncryptedData;
      const afterScattered = (await readStored('github_pat', 'scattered')) as EncryptedData;
      expect(await decryptApiKey(afterNested, nextKey)).toBe('sk-live-obsidian');
      expect(await decryptApiKey(afterScattered, nextKey)).toBe('ghp_live514');
      await expect(decryptApiKey(beforeNested, nextKey)).rejects.toThrow();
      await expect(decryptApiKey(beforeScattered, nextKey)).rejects.toThrow();
    });

    it('succeeds with no ciphertext without deriving keys (fast path)', async () => {
      const ok = await setMasterPassword('NewP@ssw0rd123!');
      expect(ok).toBe(true);
      expect(await isMasterPasswordEnabled()).toBe(true);
      const pending = await chrome.storage.local.get(StorageKeys.MASTER_PASSWORD_PENDING_SALT);
      expect(pending[StorageKeys.MASTER_PASSWORD_PENDING_SALT]).toBeUndefined();
    });
  });

  describe('KEK rotation — change', () => {
    it('migrates all seeded fields and returns true with the session on the new password', async () => {
      await setMasterPassword('OldP@ssw0rd123!');
      await unlockWithPassword('OldP@ssw0rd123!');
      await seedCiphertext('provider_api_key', 'nested', 'sk-live-provider');
      await seedCiphertext('openai_api_key', 'scattered', 'sk-live-openai');
      const before = (await readStored('provider_api_key', 'nested')) as EncryptedData;

      const ok = await changeMasterPassword('OldP@ssw0rd123!', 'NewP@ssw0rd123!');
      expect(ok).toBe(true);

      await unlockWithPassword('NewP@ssw0rd123!');
      const nextKey = await getOrCreateEncryptionKey();
      expect(await decryptApiKey((await readStored('provider_api_key', 'nested')) as EncryptedData, nextKey)).toBe(
        'sk-live-provider',
      );
      expect(await decryptApiKey((await readStored('openai_api_key', 'scattered')) as EncryptedData, nextKey)).toBe(
        'sk-live-openai',
      );
      await expect(decryptApiKey(before, nextKey)).rejects.toThrow();

      const meta = await snapshotAuth();
      expect(meta[StorageKeys.IS_LOCKED]).toBe(false);
      const pending = await chrome.storage.local.get(StorageKeys.MASTER_PASSWORD_PENDING_SALT);
      expect(pending[StorageKeys.MASTER_PASSWORD_PENDING_SALT]).toBeUndefined();
    });

    it('returns false and touches nothing when the old password is wrong', async () => {
      await setMasterPassword('OldP@ssw0rd123!');
      await unlockWithPassword('OldP@ssw0rd123!');
      await seedCiphertext('gemini_api_key', 'nested', 'sk-live-gemini');
      const metaBefore = await snapshotAuth();
      const cipherBefore = JSON.stringify(await readStored('gemini_api_key', 'nested'));

      const ok = await changeMasterPassword('WrongOldPass123!', 'NewP@ssw0rd123!');

      expect(ok).toBe(false);
      expect(await snapshotAuth()).toEqual(metaBefore);
      expect(JSON.stringify(await readStored('gemini_api_key', 'nested'))).toBe(cipherBefore);
    });
  });

  describe('KEK rotation — remove', () => {
    it('keeps all fields readable under the anonymous KEK and deletes auth metadata', async () => {
      await setMasterPassword('OldP@ssw0rd123!');
      await unlockWithPassword('OldP@ssw0rd123!');
      await seedCiphertext('obsidian_api_key', 'nested', 'sk-live-obsidian');
      await seedCiphertext('github_pat', 'scattered', 'ghp_live514');

      await removeMasterPassword('OldP@ssw0rd123!');

      expect(await isMasterPasswordEnabled()).toBe(false);
      const stored = await chrome.storage.local.get([...AUTH_KEYS]);
      for (const key of [
        StorageKeys.MASTER_PASSWORD_ENABLED,
        StorageKeys.MASTER_PASSWORD_SALT,
        StorageKeys.MASTER_PASSWORD_HASH,
        StorageKeys.IS_LOCKED,
      ] as const) {
        expect(stored[key]).toBeUndefined();
      }
      // KDF_ITERATIONS stays (the adjudicated 4-key removal contract): a future
      // set derives the new KEK from freshly written iterations, never this one.
      // Anonymous KEK opens the kept values (no password in session).
      const anonKey = await getOrCreateEncryptionKey();
      expect(await decryptApiKey((await readStored('obsidian_api_key', 'nested')) as EncryptedData, anonKey)).toBe(
        'sk-live-obsidian',
      );
      expect(await decryptApiKey((await readStored('github_pat', 'scattered')) as EncryptedData, anonKey)).toBe(
        'ghp_live514',
      );
    });

    it('cleans up idempotently when no master password is set', async () => {
      await removeMasterPassword();
      expect(await isMasterPasswordEnabled()).toBe(false);
      // Second call is equally quiet (idempotent cleanup branch).
      await removeMasterPassword();
      expect(await isMasterPasswordEnabled()).toBe(false);
    });

    it('rejects without a password or cached session and touches nothing', async () => {
      await setMasterPassword('OldP@ssw0rd123!');
      await unlockWithPassword('OldP@ssw0rd123!');
      await seedCiphertext('openai_2_api_key', 'scattered', 'sk-live-oai2');
      clearEncryptionKeyCache();
      const metaBefore = await snapshotAuth();
      const cipherBefore = JSON.stringify(await readStored('openai_2_api_key', 'scattered'));

      await expect(removeMasterPassword()).rejects.toThrow('ENCRYPTION_LOCKED');

      expect(await snapshotAuth()).toEqual(metaBefore);
      expect(JSON.stringify(await readStored('openai_2_api_key', 'scattered'))).toBe(cipherBefore);
    });
  });

  describe('KEK rotation — abort', () => {
    it('aborts on one undecryptable field: metadata and ciphertext untouched, anchor never written', async () => {
      await setMasterPassword('OldP@ssw0rd123!');
      await unlockWithPassword('OldP@ssw0rd123!');
      await seedCiphertext('obsidian_api_key', 'nested', 'sk-live-obsidian');
      // Ciphertext-shaped but bound to no known KEK.
      const garbageField = API_KEY_FIELD_NAMES.find((f) => f === 'provider_api_key') ?? garbageField;
    const garbage = { ciphertext: btoa('unrelated-ciphertext-payload-000'), iv: btoa('unrelated-iv-0') };
      await chrome.storage.local.set({ [garbageField]: garbage });
      const metaBefore = await snapshotAuth();
      const nestedBefore = JSON.stringify(
        ((await chrome.storage.local.get('settings')) as Record<string, unknown>)['settings'],
      );
      const scatteredBefore = JSON.stringify(
        await chrome.storage.local.get(garbageField),
      );

      const error = await removeMasterPassword('OldP@ssw0rd123!').catch((e: unknown) => e);

      // Positive anchor: the abort names the field and nothing else.
      expect(error).toBeInstanceOf(ReencryptionAbortedError);
      expect((error as ReencryptionAbortedError).fields).toEqual([garbageField]);
      const serialized = JSON.stringify(error);
      expect(serialized).not.toContain('sk-live-obsidian');
      // Nothing was written: metadata and ciphertext are intact, and the remove
    // path never writes an anchor (no pending salt exists to clean).
      expect(await snapshotAuth()).toEqual(metaBefore);
      expect(
        JSON.stringify(((await chrome.storage.local.get('settings')) as Record<string, unknown>)['settings']),
      ).toBe(nestedBefore);
      expect(JSON.stringify(await chrome.storage.local.get(garbageField))).toBe(scatteredBefore);
      const pending = await chrome.storage.local.get(StorageKeys.MASTER_PASSWORD_PENDING_SALT);
      expect(pending[StorageKeys.MASTER_PASSWORD_PENDING_SALT]).toBeUndefined();
      // The good field still opens under the old KEK (no empty overwrite).
      const oldKey = await getOrCreateEncryptionKey();
      expect(await decryptApiKey((await readStored('obsidian_api_key', 'nested')) as EncryptedData, oldKey)).toBe(
        'sk-live-obsidian',
      );
    });
  });

  describe('KEK rotation — resume', () => {
    it('reuses the anchored salt after an interrupted change and converges without abort', async () => {
      await setMasterPassword('OldP@ssw0rd123!');
      await unlockWithPassword('OldP@ssw0rd123!');
      await seedCiphertext('obsidian_api_key', 'nested', 'sk-live-obsidian');
      await seedCiphertext('github_pat', 'scattered', 'ghp_live514');
      const metaBefore = await snapshotAuth();

      // Run 1 completes: both fields under the new KEK, anchor salt S2 stored.
      await changeMasterPassword('OldP@ssw0rd123!', 'NewP@ssw0rd123!');
      const metaAfter = await snapshotAuth();
      const saltAfter = metaAfter[StorageKeys.MASTER_PASSWORD_SALT] as string;
      const migratedNested = await readStored('obsidian_api_key', 'nested');
      const migratedScattered = await readStored('github_pat', 'scattered');
      expect(migratedNested).toBeDefined();
      expect(migratedScattered).toBeDefined();

      // Simulate a crash mid-change of run 2: metadata back to pre-change,
      // the nested field already migrated, the scattered field still under
      // the old KEK, and run 1's anchor salt present as the dead run left it.
      await chrome.storage.local.set({ ...(metaBefore as Record<string, unknown>) });
      await chrome.storage.local.set({ settings: { obsidian_api_key: migratedNested } });
      clearEncryptionKeyCache();
      await unlockWithPassword('OldP@ssw0rd123!');
      const oldKey = await getOrCreateEncryptionKey();
      const { encryptApiKey: encryptOld } = await import('../../crypto/index.js');
      const githubField = API_KEY_FIELD_NAMES.find((f) => f === 'github_pat') as string;
      await chrome.storage.local.set({ [githubField]: await encryptOld('ghp_live514', oldKey) });
      await chrome.storage.local.set({ [StorageKeys.MASTER_PASSWORD_PENDING_SALT]: saltAfter });

      // Run 2 must succeed (not abort): the nested field skips as migrated,
      // the scattered field migrates, and the anchor salt is reused verbatim
      // instead of regenerated.
      await changeMasterPassword('OldP@ssw0rd123!', 'NewP@ssw0rd123!');

      const metaFinal = await snapshotAuth();
      expect(metaFinal[StorageKeys.MASTER_PASSWORD_SALT]).toBe(saltAfter);
      const pending = await chrome.storage.local.get(StorageKeys.MASTER_PASSWORD_PENDING_SALT);
      expect(pending[StorageKeys.MASTER_PASSWORD_PENDING_SALT]).toBeUndefined();
      await unlockWithPassword('NewP@ssw0rd123!');
      const nextKey = await getOrCreateEncryptionKey();
      expect(
        await decryptApiKey((await readStored('obsidian_api_key', 'nested')) as EncryptedData, nextKey),
      ).toBe('sk-live-obsidian');
      expect(
        await decryptApiKey((await readStored('github_pat', 'scattered')) as EncryptedData, nextKey),
      ).toBe('ghp_live514');
    });
  });
});

