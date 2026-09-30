import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyMigrationsAndDecryptWithReEncrypt } from '../settingsMigration.js';
import { StorageKeys } from '../types.js';
import { encryptApiKey } from '../../crypto/index.js';

vi.mock('../../logger/types.js', () => ({
  logInfo: vi.fn(() => Promise.resolve()),
  logWarn: vi.fn(() => Promise.resolve()),
  logError: vi.fn(() => Promise.resolve()),
  logDebug: vi.fn(() => Promise.resolve()),
  ErrorCode: {
    CRYPTO_DECRYPTION_FAILURE: 'CRYPTO_002',
    CRYPTO_KEY_DERIVE_FAILURE: 'CRYPTO_001',
    CRYPTO_ENCRYPTION_FAILURE: 'CRYPTO_003',
  },
}));
vi.mock('../../logger/core.js', () => ({
  logInfo: vi.fn(() => Promise.resolve()),
  logWarn: vi.fn(() => Promise.resolve()),
  logError: vi.fn(() => Promise.resolve()),
  logDebug: vi.fn(() => Promise.resolve()),
  ErrorCode: {
    CRYPTO_DECRYPTION_FAILURE: 'CRYPTO_002',
    CRYPTO_KEY_DERIVE_FAILURE: 'CRYPTO_001',
    CRYPTO_ENCRYPTION_FAILURE: 'CRYPTO_003',
  },
}));
vi.mock('../../logger/api.js', () => ({
  logInfo: vi.fn(() => Promise.resolve()),
  logWarn: vi.fn(() => Promise.resolve()),
  logError: vi.fn(() => Promise.resolve()),
  logDebug: vi.fn(() => Promise.resolve()),
  ErrorCode: {
    CRYPTO_DECRYPTION_FAILURE: 'CRYPTO_002',
    CRYPTO_KEY_DERIVE_FAILURE: 'CRYPTO_001',
    CRYPTO_ENCRYPTION_FAILURE: 'CRYPTO_003',
  },
}));

async function generateKey(): Promise<CryptoKey> {
  return globalThis.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

describe('settingsMigration — locked session signal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flags locked and keeps ciphertext when the key provider reports ENCRYPTION_LOCKED', async () => {
    const key = await generateKey();
    const ciphertext = await encryptApiKey('sk-secret', key, StorageKeys.GEMINI_API_KEY);

    const result = await applyMigrationsAndDecryptWithReEncrypt(
      { [StorageKeys.GEMINI_API_KEY]: ciphertext } as never,
      { getEncryptionKey: async () => { throw new Error('ENCRYPTION_LOCKED: Master password required'); } },
    );

    expect(result.locked).toBe(true);
    expect(result.settings[StorageKeys.GEMINI_API_KEY]).toEqual(ciphertext);
    expect(result.reEncrypted).toEqual({});
    expect(result.unrecoverable).toHaveLength(0);
  });

  it('does not flag locked for other key derivation failures', async () => {
    const key = await generateKey();
    const ciphertext = await encryptApiKey('sk-secret', key, StorageKeys.GEMINI_API_KEY);

    const result = await applyMigrationsAndDecryptWithReEncrypt(
      { [StorageKeys.GEMINI_API_KEY]: ciphertext } as never,
      { getEncryptionKey: async () => { throw new Error('CORRUPTION: encryption salt missing'); } },
    );

    expect(result.locked).toBe(false);
    expect(result.settings[StorageKeys.GEMINI_API_KEY]).toEqual(ciphertext);
  });

  it('reports locked=false when decryption succeeds', async () => {
    const key = await generateKey();
    const ciphertext = await encryptApiKey('sk-secret', key, StorageKeys.GEMINI_API_KEY);

    const result = await applyMigrationsAndDecryptWithReEncrypt(
      { [StorageKeys.GEMINI_API_KEY]: ciphertext } as never,
      { getEncryptionKey: async () => key },
    );

    expect(result.locked).toBe(false);
    expect(result.settings[StorageKeys.GEMINI_API_KEY]).toBe('sk-secret');
  });
});
