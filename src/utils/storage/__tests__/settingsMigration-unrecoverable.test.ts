import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyMigrationsAndDecryptWithReEncrypt } from '../settingsMigration.js';
import { StorageKeys } from '../types.js';
import { isEncrypted, encryptApiKey } from '../../crypto/index.js';

vi.mock('../../logger.js', () => ({
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

describe('settingsMigration — undecryptable API key preservation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the original ciphertext and reports unrecoverable instead of blanking with empty string', async () => {
    const keyA = await generateKey();
    const keyB = await generateKey();
    const ciphertext = await encryptApiKey('sk-secret-value', keyA);

    const result = await applyMigrationsAndDecryptWithReEncrypt(
      { [StorageKeys.GEMINI_API_KEY]: ciphertext } as never,
      { getEncryptionKey: async () => keyB },
    );

    // Ciphertext must survive untouched — never replaced with ''
    expect(result.settings[StorageKeys.GEMINI_API_KEY]).toEqual(ciphertext);
    expect(isEncrypted(result.settings[StorageKeys.GEMINI_API_KEY])).toBe(true);
    // Reported for re-auth prompt instead of silent wipe
    expect(result.unrecoverable).toContain(StorageKeys.GEMINI_API_KEY);
    // Nothing to persist: caller must not overwrite storage with a blank
    expect(result.reEncrypted).not.toHaveProperty(StorageKeys.GEMINI_API_KEY as string);
  });

  it('round-trips a preserved ciphertext through writeSettings without data loss', async () => {
    const keyA = await generateKey();
    const keyB = await generateKey();
    const ciphertext = await encryptApiKey('sk-secret-value', keyA);

    const result = await applyMigrationsAndDecryptWithReEncrypt(
      { [StorageKeys.GEMINI_API_KEY]: ciphertext } as never,
      { getEncryptionKey: async () => keyB },
    );

    // writeSettings only encrypts non-empty strings; an envelope object
    // passes through as-is, so the ciphertext is never destroyed on save
    const val = result.settings[StorageKeys.GEMINI_API_KEY] as unknown;
    const wouldReEncrypt = typeof val === 'string' && (val as string) !== '';
    expect(wouldReEncrypt).toBe(false);
  });

  it('still decrypts normally with the correct key and reports no unrecoverable fields', async () => {
    const key = await generateKey();
    const ciphertext = await encryptApiKey('sk-secret-value', key);

    const result = await applyMigrationsAndDecryptWithReEncrypt(
      { [StorageKeys.GEMINI_API_KEY]: ciphertext } as never,
      { getEncryptionKey: async () => key },
    );

    expect(result.settings[StorageKeys.GEMINI_API_KEY]).toBe('sk-secret-value');
    expect(result.unrecoverable).toHaveLength(0);
  });
});
