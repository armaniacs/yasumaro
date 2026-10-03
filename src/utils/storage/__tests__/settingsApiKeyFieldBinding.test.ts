/**
 * settingsApiKeyFieldBinding.test.ts (PBI 2026-09-30-03)
 *
 * Storage-level AAD binding: what SettingsRepository / settingsMigration
 * actually write and read back. Covers the BDD scenarios — a swapped
 * ciphertext never comes back as plaintext, and v1 data still reads until a
 * write re-encrypts it as v2.
 *
 * Real WebCrypto with reduced PBKDF2 iterations; Map-backed chrome.storage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installTestSecretKek } from '../../crypto/__tests__/secretKekHelper.js';
import { settingsRepository } from '../SettingsRepository.js';
import { getOrCreateEncryptionKey } from '../encryptionSession.js';
import { applyMigrationsAndDecryptWithReEncrypt } from '../settingsMigration.js';
import { deriveLegacyKeyFromStoredSecret } from '../../crypto/kdfNegotiator.js';
import { encrypt, encryptApiKey, decryptApiKey, isEncrypted } from '../../crypto/index.js';
import { StorageKeys } from '../types.js';
import { API_KEY_FIELD_NAMES } from '../apiKeyFields.js';
import type { EncryptedData } from '../../crypto/types.js';

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

vi.mock('../../logger/types.js', async () =>
  (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logInfo: 'resolved',
    logWarn: 'resolved',
    logError: 'resolved',
    logDebug: 'resolved',
    logSanitize: 'resolved',
    ErrorCode: { INTERNAL_ERROR: 'INT_001', API_REQUEST_FAILURE: 'API_REQ_001', CRYPTO_DECRYPTION_FAILURE: 'CRYPTO_002', CRYPTO_KEY_DERIVE_FAILURE: 'CRYPTO_001', CRYPTO_ENCRYPTION_FAILURE: 'CRYPTO_003', STORAGE_QUOTA_EXCEEDED: 'STO_001', STORAGE_WRITE_FAILURE: 'STO_003' },
  }),
);
vi.mock('../../logger/core.js', async () =>
  (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logInfo: 'resolved',
    logWarn: 'resolved',
    logError: 'resolved',
    logDebug: 'resolved',
    ErrorCode: { CRYPTO_DECRYPTION_FAILURE: 'CRYPTO_002', CRYPTO_KEY_DERIVE_FAILURE: 'CRYPTO_001', CRYPTO_ENCRYPTION_FAILURE: 'CRYPTO_003' },
  }),
);
vi.mock('../../logger/api.js', async () =>
  (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logInfo: 'resolved',
    logWarn: 'resolved',
    logError: 'resolved',
    logDebug: 'resolved',
    ErrorCode: { CRYPTO_DECRYPTION_FAILURE: 'CRYPTO_002', CRYPTO_KEY_DERIVE_FAILURE: 'CRYPTO_001', CRYPTO_ENCRYPTION_FAILURE: 'CRYPTO_003' },
  }),
);

describe('settings — API key field binding (AAD)', () => {
  let storageData: Record<string, unknown>;

  beforeEach(async () => {
    await installTestSecretKek();
    vi.clearAllMocks();
    storageData = {
      settings: {},
      settings_migrated: true,
    };
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn((keys: unknown) => {
            if (keys === null) return Promise.resolve({ ...storageData });
            if (typeof keys === 'string') return Promise.resolve({ [keys]: storageData[keys] });
            if (Array.isArray(keys)) {
              const out: Record<string, unknown> = {};
              for (const k of keys) out[k] = storageData[k];
              return Promise.resolve(out);
            }
            return Promise.resolve({});
          }),
          set: vi.fn((obj: Record<string, unknown>) => {
            Object.assign(storageData, obj);
            return Promise.resolve();
          }),
          remove: vi.fn((keys: string | string[]) => {
            for (const k of Array.isArray(keys) ? keys : [keys]) delete storageData[k];
            return Promise.resolve();
          }),
        },
        session: {
          get: vi.fn(() => Promise.resolve({})),
          set: vi.fn(() => Promise.resolve()),
          remove: vi.fn(() => Promise.resolve()),
        },
      },
    } as unknown as typeof chrome;
    settingsRepository.clearCache();
  });

  it('writes an API key as a v2 envelope bound to its own field', async () => {
    await settingsRepository.set(StorageKeys.OPENAI_API_KEY, 'sk-written-openai');

    const stored = (storageData.settings as Record<string, unknown>)[StorageKeys.OPENAI_API_KEY] as EncryptedData;
    expect(isEncrypted(stored)).toBe(true);
    expect(stored.version).toBe(2);
    const key = await getOrCreateEncryptionKey();
    expect(await decryptApiKey(stored, key, StorageKeys.OPENAI_API_KEY)).toBe('sk-written-openai');
    await expect(decryptApiKey(stored, key, StorageKeys.GEMINI_API_KEY)).rejects.toThrow('Decryption failed');
  });

  it('never returns either plaintext when two stored envelopes are swapped', async () => {
    const key = await getOrCreateEncryptionKey();
    const openai = await encryptApiKey('sk-live-openai', key, StorageKeys.OPENAI_API_KEY);
    const gemini = await encryptApiKey('AIza-live-gemini', key, StorageKeys.GEMINI_API_KEY);
    storageData.settings = {
      [StorageKeys.OPENAI_API_KEY]: gemini,
      [StorageKeys.GEMINI_API_KEY]: openai,
    };
    settingsRepository.clearCache();

    const result = await applyMigrationsAndDecryptWithReEncrypt(storageData.settings as never, {
      getEncryptionKey: async () => key,
    });

    expect(result.unrecoverable).toEqual(
      expect.arrayContaining([StorageKeys.OPENAI_API_KEY, StorageKeys.GEMINI_API_KEY]),
    );
    // The swapped ciphertext stays ciphertext — it is never handed back as a
    // usable key for the wrong provider.
    expect(result.settings[StorageKeys.OPENAI_API_KEY]).not.toBe('sk-live-openai');
    expect(result.settings[StorageKeys.GEMINI_API_KEY]).not.toBe('AIza-live-gemini');
    expect(isEncrypted(result.settings[StorageKeys.OPENAI_API_KEY])).toBe(true);
    expect(isEncrypted(result.settings[StorageKeys.GEMINI_API_KEY])).toBe(true);
  });

  it('reads v1 data unchanged on read and rewrites it as v2 on the next write', async () => {
    const key = await getOrCreateEncryptionKey();
    const v1 = await encrypt('sk-v1-touch', key);
    expect(v1.version).toBeUndefined();
    storageData.settings = { [StorageKeys.OPENAI_API_KEY]: v1 };
    settingsRepository.clearCache();

    const readBack = await settingsRepository.getAll();
    expect(readBack[StorageKeys.OPENAI_API_KEY]).toBe('sk-v1-touch');
    // Reading alone must not rewrite storage (no bulk migration on read).
    expect(
      (storageData.settings as Record<string, unknown>)[StorageKeys.OPENAI_API_KEY] as EncryptedData,
    ).toEqual(v1);

    await settingsRepository.set(StorageKeys.OPENAI_API_KEY, 'sk-v1-touch');

    const stored = (storageData.settings as Record<string, unknown>)[StorageKeys.OPENAI_API_KEY] as EncryptedData;
    expect(stored.version).toBe(2);
    expect(await decryptApiKey(stored, key, StorageKeys.OPENAI_API_KEY)).toBe('sk-v1-touch');
    await expect(decryptApiKey(stored, key, StorageKeys.GEMINI_API_KEY)).rejects.toThrow('Decryption failed');
  });

  it('reads a v1 envelope for every canonical API key field', async () => {
    const key = await getOrCreateEncryptionKey();
    const seeded: Record<string, unknown> = {};
    for (const field of API_KEY_FIELD_NAMES) {
      seeded[field] = await encrypt(`sk-v1-${field}`, key);
    }
    storageData.settings = seeded;
    settingsRepository.clearCache();

    const readBack = await settingsRepository.getAll();
    const asRecord = readBack as unknown as Record<string, unknown>;

    for (const field of API_KEY_FIELD_NAMES) {
      expect(asRecord[field]).toBe(`sk-v1-${field}`);
    }
  });

  it('re-encrypts a legacy-KDF ciphertext as a field-bound v2 envelope', async () => {
    // Seed the legacy secret/salt pair first: the anonymous KEK below derives
    // from the same pair with the current iteration count, which is exactly
    // the 100k → SSOT boundary this path exists for.
    storageData[StorageKeys.ENCRYPTION_SECRET] = btoa('legacy-secret-material-for-kdf-test');
    storageData[StorageKeys.ENCRYPTION_SALT] = btoa('legacy-salt-16bytes!');
    const legacyKey = await deriveLegacyKeyFromStoredSecret();
    expect(legacyKey).not.toBeNull();
    const legacyCiphertext = await encrypt('sk-legacy-100k', legacyKey as CryptoKey);
    const currentKey = await getOrCreateEncryptionKey();

    const result = await applyMigrationsAndDecryptWithReEncrypt(
      { [StorageKeys.GEMINI_API_KEY]: legacyCiphertext } as never,
      { getEncryptionKey: async () => currentKey },
    );

    expect(result.settings[StorageKeys.GEMINI_API_KEY]).toBe('sk-legacy-100k');
    const reEncrypted = result.reEncrypted[StorageKeys.GEMINI_API_KEY] as EncryptedData;
    expect(reEncrypted.version).toBe(2);
    expect(await decryptApiKey(reEncrypted, currentKey, StorageKeys.GEMINI_API_KEY)).toBe('sk-legacy-100k');
    await expect(decryptApiKey(reEncrypted, currentKey, StorageKeys.OPENAI_API_KEY)).rejects.toThrow(
      'Decryption failed',
    );
  });
});
