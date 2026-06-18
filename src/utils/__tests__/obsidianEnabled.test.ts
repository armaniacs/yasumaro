import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getSettings, clearSettingsCache, StorageKeys, DEFAULT_SETTINGS } from '../storage.js';

const mockStorage: Record<string, unknown> = {};

vi.mock('../logger.js', () => ({
  logInfo: vi.fn(),
  logDebug: vi.fn(),
  logError: vi.fn(),
  ErrorCode: { CRYPTO_DECRYPTION_FAILURE: 'CRYPTO_001', CRYPTO_KEY_DERIVE_FAILURE: 'CRYPTO_002' },
}));

vi.mock('../crypto.js', () => ({
  encryptApiKey: vi.fn(async (v: string) => ({ ciphertext: 'enc_' + v, iv: 'iv' })),
  decryptApiKey: vi.fn(async (data: unknown) => {
    if (data && typeof data === 'object' && 'ciphertext' in data) {
      return (data as { ciphertext: string }).ciphertext.replace('enc_', '');
    }
    return data;
  }),
  isEncrypted: vi.fn((v: unknown) => v && typeof v === 'object' && 'ciphertext' in (v as object)),
  generateSalt: vi.fn(() => new Uint8Array(16)),
  deriveKey: vi.fn(async () => 'mock_key' as unknown as CryptoKey),
  hashPasswordWithPBKDF2: vi.fn(async () => 'hash'),
  verifyPasswordWithPBKDF2: vi.fn(async () => true),
}));

vi.mock('../optimisticLock.js', () => ({
  withOptimisticLock: vi.fn(async (_key: string, fn: (current: unknown) => unknown) => {
    return fn(mockStorage['settings'] || {});
  }),
}));

vi.mock('../migration.js', () => ({
  migrateUblockSettings: vi.fn(async () => false),
}));

vi.mock('../masterPassword.js', () => ({
  calculatePasswordStrength: vi.fn(() => ({ score: 80, level: 'strong' })),
}));

vi.mock('../urlUtils.js', () => ({
  normalizeUrl: vi.fn((url: string) => url),
}));

vi.mock('../trustDb/trustDb.js', () => ({
  getTrustDb: vi.fn(() => ({
    initialize: vi.fn(async () => {}),
  })),
}));

beforeEach(() => {
  for (const key of Object.keys(mockStorage)) {
    delete mockStorage[key];
  }

  const mockChrome = {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[] | null) => {
          if (keys === null) return { ...mockStorage };
          if (typeof keys === 'string') return { [keys]: mockStorage[keys] };
          const result: Record<string, unknown> = {};
          for (const key of keys) {
            if (key in mockStorage) result[key] = mockStorage[key];
          }
          return result;
        }),
        set: vi.fn(async (data: Record<string, unknown>) => {
          Object.assign(mockStorage, data);
        }),
        remove: vi.fn(async (keys: string[]) => {
          for (const key of keys) delete mockStorage[key];
        }),
        getBytesInUse: vi.fn(async () => 0),
      },
    },
  };
  (global as unknown as { chrome: typeof mockChrome }).chrome = mockChrome;
  clearSettingsCache();
});

describe('StorageKeys.OBSIDIAN_ENABLED', () => {
  it('defaults to false in DEFAULT_SETTINGS', () => {
    expect(DEFAULT_SETTINGS[StorageKeys.OBSIDIAN_ENABLED]).toBe(false);
  });
});

describe('getSettings() obsidian_enabled migration', () => {
  it('sets obsidian_enabled to true when undefined and API key >= 16 chars', async () => {
    mockStorage['settings_migrated'] = true;
    mockStorage['settings'] = {
      obsidian_api_key: '1234567890abcdef',
      obsidian_protocol: 'https',
      obsidian_port: '27124',
    };

    const settings = await getSettings();

    expect(settings[StorageKeys.OBSIDIAN_ENABLED]).toBe(true);
  });

  it('sets obsidian_enabled to true when undefined and API key > 16 chars', async () => {
    mockStorage['settings_migrated'] = true;
    mockStorage['settings'] = {
      obsidian_api_key: 'very_long_api_key_12345',
    };

    const settings = await getSettings();

    expect(settings[StorageKeys.OBSIDIAN_ENABLED]).toBe(true);
  });

  it('sets obsidian_enabled to false when undefined and API key is empty', async () => {
    mockStorage['settings_migrated'] = true;
    mockStorage['settings'] = {
      obsidian_api_key: '',
    };

    const settings = await getSettings();

    expect(settings[StorageKeys.OBSIDIAN_ENABLED]).toBe(false);
  });

  it('sets obsidian_enabled to false when undefined and API key < 16 chars', async () => {
    mockStorage['settings_migrated'] = true;
    mockStorage['settings'] = {
      obsidian_api_key: 'short',
    };

    const settings = await getSettings();

    expect(settings[StorageKeys.OBSIDIAN_ENABLED]).toBe(false);
  });

  it('preserves explicitly set obsidian_enabled: true', async () => {
    mockStorage['settings_migrated'] = true;
    mockStorage['settings'] = {
      obsidian_enabled: true,
      obsidian_api_key: '',
    };

    const settings = await getSettings();

    expect(settings[StorageKeys.OBSIDIAN_ENABLED]).toBe(true);
  });

  it('preserves explicitly set obsidian_enabled: false', async () => {
    mockStorage['settings_migrated'] = true;
    mockStorage['settings'] = {
      obsidian_enabled: false,
      obsidian_api_key: '1234567890abcdef',
    };

    const settings = await getSettings();

    expect(settings[StorageKeys.OBSIDIAN_ENABLED]).toBe(false);
  });

  it('falls back to DEFAULT_SETTINGS obsidian_enabled: false when settings object is empty', async () => {
    mockStorage['settings_migrated'] = true;
    mockStorage['settings'] = {};

    const settings = await getSettings();

    expect(settings[StorageKeys.OBSIDIAN_ENABLED]).toBe(false);
  });
});
